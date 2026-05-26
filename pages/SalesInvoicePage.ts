import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { InvoiceInput } from '../utils/ExcelManager';

export class SalesInvoicePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await this.page.goto('https://hitechdairy.in/account-finance/transactions/sales-invoice');
    await this.page.waitForLoadState('networkidle');
    await this.waitForStep();
  }

  async selectUnitName(unitName: string) {
    console.log(`[SalesInvoicePage] Selecting Unit Name: ${unitName}`);
    await this.page.getByText('Select Unit Name').click();
    await this.selectVisibleOptionWithSearch(unitName, unitName);
  }

  async selectCustomer(partyName: string) {
    console.log(`[SalesInvoicePage] Selecting Customer/Party Name: ${partyName}`);
    await this.page.getByText('Select Customer/Party Name').click();
    const codePattern = new RegExp(`\\([A-Za-z]+-${this.escapeRegExp(partyName)}\\)`);
    await this.selectVisibleOptionWithSearch(`-${partyName}`, codePattern);
  }

  private toAppDate(csvDate: string) {
    const [day, month, year] = csvDate.split('.');
    return `${day}/${month}/${year}`;
  }

  private getDateParts(csvDate: string) {
    const [day, month, year] = csvDate.split('.');
    return { day: Number(day), month: Number(month), year: Number(year) };
  }

  private getMonthName(month: number) {
    return [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ][month - 1];
  }

  async setInvoiceDate(csvDate: string) {
    console.log(`[SalesInvoicePage] Setting Sales Invoice Date: ${csvDate}`);
    const targetDate = this.toAppDate(csvDate);
    const { day, month, year } = this.getDateParts(csvDate);
    const dateTextbox = this.page.getByRole('textbox', { name: 'Sales Invoice Date' });
    const currentDateValue = await dateTextbox.inputValue();

    if (currentDateValue === targetDate) return;

    const currentDateMatch = currentDateValue.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!currentDateMatch) throw new Error(`Could not read current Sales Invoice Date: "${currentDateValue}"`);

    const currentMonth = Number(currentDateMatch[2]);
    const currentYear = Number(currentDateMatch[3]);
    const monthDifference = (currentYear - year) * 12 + (currentMonth - month);

    const openCalendarButton = this.page.locator("xpath=//mat-label[contains(text(),'Sales Invoice Date')]/ancestor::mat-form-field//button[@aria-label='Open calendar']");
    await openCalendarButton.click();
    await this.waitForStep();

    for (let i = 0; i < monthDifference; i++) {
      await this.page.getByRole('button', { name: 'Previous month' }).click();
      await this.waitForStep();
    }
    for (let i = 0; i < -monthDifference; i++) {
      await this.page.getByRole('button', { name: 'Next month' }).click();
      await this.waitForStep();
    }

    const monthName = this.getMonthName(month);
    const dayButton = this.page
      .getByRole('button', { name: new RegExp(`(^|\\D)0?${day}(\\D|$).*${monthName}|${monthName}.*(^|\\D)0?${day}(\\D|$)`, 'i') })
      .first();
    const dayCellText = this.page.locator('.mat-calendar-body-cell-content').getByText(String(day), { exact: true }).first();

    if (await dayButton.isVisible()) {
      await dayButton.click();
    } else {
      await dayCellText.click();
    }

    await this.waitForStep();
    await expect(dateTextbox).toHaveValue(targetDate);
  }

  async selectSaleLedger(ledgerSearchText: string, ledgerPattern: RegExp) {
    console.log(`[SalesInvoicePage] Selecting Sale Ledger: ${ledgerSearchText}`);
    await this.page.getByText('Select Sale Ledger').click();
    await this.selectVisibleOptionWithSearch(ledgerSearchText, ledgerPattern);
  }

  async addMaterialItem(materialName: string, quantity: string, rate: string) {
    console.log(`[SalesInvoicePage] Adding Material Item: ${materialName}`);
    await this.page.locator('[formcontrolname="materialId"]').click();
    await this.selectVisibleOptionWithSearch(materialName.trim(), materialName.trim());

    const quantityInput = this.page.locator('xpath=//mat-label[text()="Quantity"]');
    await quantityInput.click();
    await this.waitForStep();
    await quantityInput.fill(quantity);
    await this.waitForStep();

    await this.page.getByRole('textbox', { name: 'Rate' }).click();
    await this.waitForStep();
    await this.page.getByRole('textbox', { name: 'Rate' }).fill(rate);
    await this.waitForStep();

    await this.page.locator("xpath=//button[@mattooltip='add' and .//mat-icon[contains(text(),'add')]]").click();
    await this.waitForStep();

    try {
      const yesBtn = this.page.getByRole('button', { name: 'Yes', exact: true });
      await yesBtn.waitFor({ state: 'visible', timeout: 3000 });
      await yesBtn.click();
      await this.waitForStep();
    } catch (e) {
      // Optional confirmation, ignore if missing
    }
  }

  async submitInvoice() {
    console.log(`[SalesInvoicePage] Submitting Invoice...`);

    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('SalesPurchaseInvoice/AddSalesPurchaseInvoiceV1') &&
        response.status() === 200 &&
        response.request().method() === 'POST',
      { timeout: 60000 }
    );

    const submitLocators = [
      this.page.getByRole('button', { name: 'Submit' }),
      this.page.locator("xpath=//button[.//span[normalize-space()='Submit']]"),
      this.page.locator("//button[contains(.,'Submit')]"),
      this.page.locator("button:has-text('Submit')"),
      this.page.locator("xpath=//span[text()='Submit']/ancestor::button")
    ];

    let submitClicked = false;
    for (const locator of submitLocators) {
      try {
        const elements = await locator.all();
        for (const btn of elements) {
          if (!(await btn.isVisible())) continue;

          await btn.scrollIntoViewIfNeeded();
          try {
            await btn.click({ timeout: 5000 });
          } catch (clickErr) {
            await btn.click({ timeout: 5000, force: true });
          }
          submitClicked = true;
          break;
        }
        if (submitClicked) break;
      } catch (e: any) {
        // Continue
      }
    }

    if (!submitClicked) {
      throw new Error("Could not find or click a visible Submit button.");
    }
    
    await this.waitForStep();
    
    // Wait for the actual POST network response to complete
    const response = await responsePromise;
    const responseBody = await response.json();
    return responseBody;
  }
}
