import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { appConfig } from '../utils/config';
import { ExcelManager } from '../utils/ExcelManager';
import { Logger } from '../utils/Logger';
import { SalesInvoicePage } from '../pages/SalesInvoicePage';
import { LoginPage } from '../pages/LoginPage';

class SalesInvoiceRunner {
  private page: Page;
  private excelManager: ExcelManager;
  private logger: Logger;
  private salesPage: SalesInvoicePage;
  private loginPage: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.excelManager = new ExcelManager();
    this.logger = new Logger();
    this.salesPage = new SalesInvoicePage(page);
    this.loginPage = new LoginPage(page);
  }

  private handleSession() {
    const statePath = path.resolve(process.cwd(), 'storageState.json');
    if (appConfig.clearSession) {
      fs.writeFileSync(statePath, JSON.stringify({ cookies: [], origins: [] }), 'utf-8');
      console.log('\n[INFO] CLEAR_SESSION is enabled. Emptied storageState.json to force a fresh login.\n');
    } else if (!fs.existsSync(statePath)) {
      fs.writeFileSync(statePath, JSON.stringify({ cookies: [], origins: [] }), 'utf-8');
    }
  }

  async run() {
    // 1. Setup Session
    this.handleSession();
    
    // 2. Load and Filter Data
    const allInputs = await this.excelManager.loadInvoiceInputs();
    const filteredInputs = allInputs.filter(({ invoice }) => !appConfig.runStatus || invoice.status === appConfig.runStatus);

    if (filteredInputs.length === 0) {
      console.log('No matching records found in the Excel file.');
      return;
    }

    // 3. Process Each Row
    for (const { invoice, rowIndex } of filteredInputs) {
      console.log(`\n=== Starting processing for Excel Row ${rowIndex} ===`);
      
      try {
        await this.salesPage.goto();
        
        // Handle unexpected login redirects
        const tabTitle = await this.page.title();
        if (tabTitle.includes('Login')) {
          console.log(`[Row ${rowIndex}] Login tab detected. Running login test...`);
          await this.loginPage.loginWithRetry(3);
          await this.page.context().storageState({ path: 'storageState.json' });
          console.log(`[Row ${rowIndex}] Saved fresh storageState.json.`);
          await this.salesPage.goto();
        }

        // Fill out the invoice
        if (invoice.unitName) await this.salesPage.selectUnitName(invoice.unitName);
        if (invoice.partyName) await this.salesPage.selectCustomer(invoice.partyName);
        if (invoice.invoiceDate) await this.salesPage.setInvoiceDate(invoice.invoiceDate);

        const ledgerSearchText = process.env.DEFAULT_SALE_LEDGER || 'Fodder Sales';
        await this.salesPage.selectSaleLedger(ledgerSearchText, appConfig.saleLedger);
        await this.salesPage.addMaterialItem(invoice.materialName, invoice.quantity, invoice.rate);

        const responseBody = await this.salesPage.submitInvoice();
        
        // Update Success
        const insertStatusMsg = responseBody?.response?.id || 'Success (No ID)';
        console.log(`[Row ${rowIndex}] Success! Updating Excel with status...`);
        await this.excelManager.updateExcelColumn(rowIndex, 'insertStatus', insertStatusMsg.toString());
        await this.excelManager.updateExcelColumn(rowIndex, 'status', 'success');

      } catch (error: any) {
        // Handle Failure
        console.error(`\n[ERROR] Row ${rowIndex} failed: ${error.message}`);
        await this.logger.logFailure(this.page, `Row_${rowIndex}`, error.message);
        
        // Update Skipped
        await this.excelManager.updateExcelColumn(rowIndex, 'status', 'skipped');
        console.log(`[Row ${rowIndex}] Marked as skipped in Excel. Moving to next row...`);
      }
    }
  }
}

/**
 * ===================================
 * PLAYWRIGHT TEST ENTRY POINT
 * ===================================
 */
test.describe('Sales Invoice Automation (Pure OOP)', () => {
  test.setTimeout(0); // Unlimited timeout for single window processing

  test(`Create All Sales Invoices from Excel sequentially`, async ({ page }) => {
    // Set default timeout to 1 minute to automatically break out of stuck operations
    page.setDefaultTimeout(60000);
    
    // Instantiate the OOP Runner and execute
    const runner = new SalesInvoiceRunner(page);
    await runner.run();
  });
});
