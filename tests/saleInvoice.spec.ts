import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginWithRetry } from './helpers/auth';

const stepWait = 400;
const invoiceInputPath = path.resolve(process.cwd(), 'DataDriven', 'invoice-input.csv');

const appConfig = {
  voucher: process.env.DEFAULT_VOUCHER || 'Sales Invoice',
  saleLedger: new RegExp(process.env.DEFAULT_SALE_LEDGER || 'Fodder Sales'),
  runStatus: process.env.RUN_STATUS || '', // '' = process all, 'skipped' = process only skipped, 'success' = process only success
  clearSession: process.env.CLEAR_SESSION === 'true',
};

// Ensure storageState.json exists so Playwright doesn't crash, and clear it if CLEAR_SESSION is true
const statePath = path.resolve(process.cwd(), 'storageState.json');
if (appConfig.clearSession) {
  fs.writeFileSync(statePath, JSON.stringify({ cookies: [], origins: [] }), 'utf-8');
  console.log('\n[INFO] CLEAR_SESSION is enabled. Emptied storageState.json to force a fresh login.\n');
} else if (!fs.existsSync(statePath)) {
  fs.writeFileSync(statePath, JSON.stringify({ cookies: [], origins: [] }), 'utf-8');
}

type InvoiceInput = {
  unitName: string;
  partyName: string;
  invoiceDate: string;
  discountPercent: string;
  discountAmount: string;
  totalAmount: string;
  quantity: string;
  rate: string;
  salePrice: string;
  companyLedgerId: string;
  voucherTypeId: string;
  materialName: string;
  insertStatus: string;
  status: string;
};

async function waitForStep(page: Page) {
  await page.waitForTimeout(stepWait);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function loadInvoiceInputs() {
  const csv = fs.readFileSync(invoiceInputPath, 'utf-8').trim();
  const [headerLine, ...lines] = csv.split(/\r?\n/);
  const headers = parseCsvLine(headerLine);

  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const values = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));

      return {
        unitName: row.unitName ?? '',
        partyName: (row.partyName ?? '').replace(/"/g, ''),
        invoiceDate: row.invoiceDate ?? '',
        discountPercent: row.discountPercent ?? '',
        discountAmount: row.discountAmount ?? '',
        totalAmount: row.totalAmount ?? '',
        quantity: row.quantity ?? '',
        rate: row.rate ?? '',
        salePrice: row.salePrice ?? '',
        companyLedgerId: row.companyLedgerId ?? '',
        voucherTypeId: row.voucherTypeId ?? '',
        materialName: row.materialName ?? '',
        insertStatus: row.insertStatus ?? '',
        status: row.status ?? '',
      };
    });
}

async function updateCsvColumn(rowIndex: number, columnName: string, value: string) {
  const csv = fs.readFileSync(invoiceInputPath, 'utf-8').trim();
  const lines = csv.split(/\r?\n/);
  
  if (rowIndex + 1 >= lines.length) {
    console.error(`Row index ${rowIndex} out of bounds for CSV update.`);
    return;
  }
  
  const headers = parseCsvLine(lines[0]);
  let columnIndex = headers.indexOf(columnName);
  
  // If the column doesn't exist, dynamically add it to the header
  if (columnIndex === -1) {
    headers.push(columnName);
    columnIndex = headers.length - 1;
    lines[0] = headers.map(val => val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val).join(',');
  }
  
  const values = parseCsvLine(lines[rowIndex + 1]);
  
  // Ensure the row has enough columns
  while (values.length <= columnIndex) {
    values.push('');
  }
  
  values[columnIndex] = value;
  
  const formattedRow = values.map(val => {
    if (val.includes(',') || val.includes('"')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }).join(',');
  
  lines[rowIndex + 1] = formattedRow;
  
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.writeFileSync(invoiceInputPath, lines.join('\n') + '\n', 'utf-8');
      break;
    } catch (error: any) {
      if (error.code === 'EBUSY') {
        console.warn(`\n[WARNING] The CSV file is locked (likely open in Excel). Please close it! Retrying in 3 seconds... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.error('Failed to update CSV:', error);
        break;
      }
    }
  }
}

function toAppDate(csvDate: string) {
  const [day, month, year] = csvDate.split('.');
  return `${day}/${month}/${year}`;
}

function getDateParts(csvDate: string) {
  const [day, month, year] = csvDate.split('.');
  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

function getMonthName(month: number) {
  return [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][month - 1];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function setSalesInvoiceDate(page: Page, csvDate: string) {
  console.log(`[setSalesInvoiceDate] Started. Target date: "${csvDate}"`);
  const targetDate = toAppDate(csvDate);
  const { day, month, year } = getDateParts(csvDate);
  const dateTextbox = page.getByRole('textbox', { name: 'Sales Invoice Date' });
  const currentDateValue = await dateTextbox.inputValue();
  console.log(`[setSalesInvoiceDate] Current date value is "${currentDateValue}"`);

  if (currentDateValue === targetDate) {
    console.log(`[setSalesInvoiceDate] Date already matches. Skipping.`);
    return;
  }

  const currentDateMatch = currentDateValue.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!currentDateMatch) {
    throw new Error(`Could not read current Sales Invoice Date value: "${currentDateValue}"`);
  }

  const currentMonthText = currentDateMatch[2];
  const currentYearText = currentDateMatch[3];
  const currentMonth = Number(currentMonthText);
  const currentYear = Number(currentYearText);
  const monthDifference = (currentYear - year) * 12 + (currentMonth - month);

  const openCalendarButton = page.locator("xpath=//mat-label[contains(text(),'Sales Invoice Date')]/ancestor::mat-form-field//button[@aria-label='Open calendar']");
  console.log(`[setSalesInvoiceDate] Clicking open calendar button...`);
  await openCalendarButton.click();
  await waitForStep(page);

  console.log(`[setSalesInvoiceDate] Navigating calendar by ${monthDifference} months...`);
  for (let index = 0; index < monthDifference; index++) {
    await page.getByRole('button', { name: 'Previous month' }).click();
    await waitForStep(page);
  }

  for (let index = 0; index < -monthDifference; index++) {
    await page.getByRole('button', { name: 'Next month' }).click();
    await waitForStep(page);
  }

  const monthName = getMonthName(month);
  const dayButton = page
    .getByRole('button', { name: new RegExp(`(^|\\D)0?${day}(\\D|$).*${monthName}|${monthName}.*(^|\\D)0?${day}(\\D|$)`, 'i') })
    .first();
  const dayCellText = page.locator('.mat-calendar-body-cell-content').getByText(String(day), { exact: true }).first();

  console.log(`[setSalesInvoiceDate] Clicking day ${day}...`);
  if (await dayButton.isVisible()) {
    await dayButton.click();
  } else {
    await dayCellText.click();
  }

  await waitForStep(page);
  await expect(dateTextbox).toHaveValue(targetDate);
  console.log(`[setSalesInvoiceDate] Finished setting date.`);
}

async function selectVisibleOption(page: Page, optionText: string | RegExp) {
  await waitForStep(page);
  await page.getByRole('option', { name: optionText }).click();
  await waitForStep(page);
}

async function selectVisibleOptionWithSearch(page: Page, searchText: string, optionText: string | RegExp) {
  console.log(`[selectVisibleOptionWithSearch] Started. Search text: "${searchText}", Option text: "${optionText}"`);
  await waitForStep(page);

  console.log(`[selectVisibleOptionWithSearch] Locating search input...`);
  const searchInput = page.locator("xpath=//input[@type='text' and contains(@placeholder,'Search') and not(@placeholder='Search Page Name')]").last();
  
  console.log(`[selectVisibleOptionWithSearch] Waiting for search input to be visible...`);
  await searchInput.waitFor({ state: 'visible', timeout: 30000 });
  
  // console.log(`[selectVisibleOptionWithSearch] Clicking search input...`);
  // await searchInput.click();
  // await waitForStep(page);
  
  console.log(`[selectVisibleOptionWithSearch] Typing search text: "${searchText}"...`);
  await searchInput.pressSequentially(searchText, { delay: 50 });
  await waitForStep(page);

  console.log(`[selectVisibleOptionWithSearch] Clicking option matching: "${optionText}"...`);
  await page.getByRole('option', { name: optionText }).click();
  
  console.log(`[selectVisibleOptionWithSearch] Finished successfully.`);
  await waitForStep(page);
}

async function selectPartyByCode(page: Page, partyCode: string) {
  // The UI text is "SHRIPAD SADASHIV SANE (SALE) (C-4)", so we need to match the "C-" or similar prefix inside the parentheses
  const codePattern = new RegExp(`\\([A-Za-z]+-${escapeRegExp(partyCode)}\\)`);
  await selectVisibleOptionWithSearch(page, `-${partyCode}`, codePattern);
}

const invoiceInputs = loadInvoiceInputs();

/**
 * ===================================
 * TESTS
 * ===================================
 */

test.describe('Sales Invoice Automation', () => {
  test.setTimeout(0); // Unlimited timeout for single window processing

  test(`Create All Sales Invoices from CSV sequentially`, async ({ page }) => {
    // Set default timeout to 1 minute to automatically break out of stuck operations
    page.setDefaultTimeout(60000);

    const filteredInputs = invoiceInputs.map((invoice, idx) => ({ invoice, index: idx }))
      .filter(({ invoice }) => !appConfig.runStatus || invoice.status === appConfig.runStatus);

    for (const { invoice, index } of filteredInputs) {
      console.log(`\n=== Starting processing for CSV Row ${index + 1} ===`);
      
      try {
        await page.goto('https://hitechdairy.in/account-finance/transactions/sales-invoice');
      await page.waitForLoadState('networkidle');
      await waitForStep(page);

      const tabTitle = await page.title();
      if (tabTitle.includes('Login')) {
        console.log(`[Test Row ${index + 1}] Login tab detected. Running login test...`);
        await loginWithRetry(page, 3);
        await page.context().storageState({ path: 'storageState.json' });
        console.log(`[Test Row ${index + 1}] Saved fresh storageState.json.`);
        
        // Go back to the Sales Invoice page after login
        await page.goto('https://hitechdairy.in/account-finance/transactions/sales-invoice');
        await page.waitForLoadState('networkidle');
        await waitForStep(page);
      } else {
        console.log(`[Test Row ${index + 1}] Sales Invoice tab detected. Proceeding...`);
      }

      // Select Unit Name
      console.log(`[Test Row ${index + 1}] Selecting Unit Name...`);
      await page.getByText('Select Unit Name').click();
      await selectVisibleOptionWithSearch(page, invoice.unitName, invoice.unitName);

      // Select Customer/Party Name
      console.log(`[Test Row ${index + 1}] Selecting Customer/Party Name...`);
      await page.getByText('Select Customer/Party Name').click();
      await selectPartyByCode(page, invoice.partyName);

      // Set Sales Invoice Date
      console.log(`[Test Row ${index + 1}] Setting Sales Invoice Date...`);
      await setSalesInvoiceDate(page, invoice.invoiceDate);

      // Select Voucher
      // console.log(`[Test Row ${index + 1}] Selecting Voucher...`);
      // await page.getByText('Select Voucher').click();
      // await selectVisibleOption(page, appConfig.voucher);

      // Select Sale Ledger
      console.log(`[Test Row ${index + 1}] Selecting Sale Ledger...`);
      await page.getByText('Select Sale Ledger').click();
      const ledgerSearchText = process.env.DEFAULT_SALE_LEDGER || 'Fodder Sales';
      await selectVisibleOptionWithSearch(page, ledgerSearchText, appConfig.saleLedger);
      

      // Select Material and add to invoice
      console.log(`[Test Row ${index + 1}] Selecting Material...`);
      await page.locator('[formcontrolname="materialId"]').click();
      await selectVisibleOptionWithSearch(page, invoice.materialName.trim(), invoice.materialName.trim());

      // Set Quantity
      console.log(`[Test Row ${index + 1}] Setting Quantity...`);
      const quantityInput = page.locator('xpath=//mat-label[text()="Quantity"]');
      await quantityInput.click();
      await waitForStep(page);
      await quantityInput.fill(invoice.quantity);
      await waitForStep(page);

      // Set Rate
      console.log(`[Test Row ${index + 1}] Setting Rate...`);
      await page.getByRole('textbox', { name: 'Rate' }).click();
      await waitForStep(page);
      await page.getByRole('textbox', { name: 'Rate' }).fill(invoice.rate);
      await waitForStep(page);

      // Add item to invoice
      console.log(`[Test Row ${index + 1}] Adding item to invoice...`);
      await page.locator("xpath=//button[@mattooltip='add' and .//mat-icon[contains(text(),'add')]]").click();
      await waitForStep(page);
      
      try {
        console.log(`[Test Row ${index + 1}] Waiting to see if a 'Yes' confirmation dialog appears...`);
        const yesBtn = page.getByRole('button', { name: 'Yes', exact: true });
        // Only wait 3 seconds for the popup to appear, rather than the default 60s
        await yesBtn.waitFor({ state: 'visible', timeout: 3000 });
        await yesBtn.click();
        console.log(`[Test Row ${index + 1}] Clicked 'Yes' confirmation.`);
        await waitForStep(page);
      } catch (e) {
        console.log(`[Test Row ${index + 1}] No 'Yes' dialog appeared within 3 seconds. Proceeding to submit...`);
      }

      // Setup response interceptor before clicking Submit
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('SalesPurchaseInvoice/AddSalesPurchaseInvoiceV1') &&
          response.status() === 200 &&
          response.request().method() === 'POST',
        { timeout: 60000 }
      );

      // Submit invoice
      console.log(`[Test Row ${index + 1}] Checking Submit button state...`);
      const submitLocators = [
        page.getByRole('button', { name: 'Submit' }),
        page.locator("xpath=//button[.//span[normalize-space()='Submit']]"),
        page.locator("//button[contains(.,'Submit')]"),
        page.locator("button:has-text('Submit')"),
        page.locator("xpath=//span[text()='Submit']/ancestor::button")
      ];

      let submitClicked = false;
      for (const locator of submitLocators) {
        try {
          const elements = await locator.all();
          for (const btn of elements) {
            const isVisible = await btn.isVisible();
            if (!isVisible) continue; // Skip hidden/ghost buttons in the DOM!
            
            const isDisabled = await btn.isDisabled();
            console.log(`[Test Row ${index + 1}] Found VISIBLE Submit button! Disabled: ${isDisabled}`);
            
            await btn.scrollIntoViewIfNeeded();
            
            // Try standard click first
            try {
              await btn.click({ timeout: 5000 });
            } catch (clickErr) {
              console.log(`[Test Row ${index + 1}] Standard click failed, attempting force click...`);
              await btn.click({ timeout: 5000, force: true });
            }
            
            console.log(`[Test Row ${index + 1}] Clicked Submit button successfully.`);
            submitClicked = true;
            break; // Break inner loop
          }
          if (submitClicked) break; // Break outer loop
        } catch (e: any) {
          console.log(`[Test Row ${index + 1}] Locator failed, trying next...`);
        }
      }

      if (!submitClicked) {
        throw new Error("Could not find or click the Submit button using any of the provided locators.");
      }
      
      await waitForStep(page);

      // Wait for the response and parse request & response data
      const response = await responsePromise;
      const request = response.request();
      
      let requestPayload: any = null;
      let requestHeaders: any = null;
      let responseBody: any = null;
      let responseHeaders: any = null;
      let responseData: any = null;

      try {
        requestPayload = request.postDataJSON();
        requestHeaders = await request.allHeaders();
      } catch (error) {
        console.error('Failed to parse API request details:', error);
      }

      try {
        responseBody = await response.json();
        responseData = responseBody.responseData;
        responseHeaders = await response.allHeaders();
        console.log(`Intercepted responseData: ${responseData}`);
      } catch (error) {
        console.error('Failed to parse API response JSON:', error);
      }

      // Save log file for this entry
      try {
        const logsDir = path.resolve(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        const logFilename = `invoice_row_${index + 1}.json`;
        const logFilePath = path.join(logsDir, logFilename);
        const logContent = {
          timestamp: new Date().toISOString(),
          rowIndex: index + 1,
          csvData: invoice,
          request: {
            url: request.url(),
            method: request.method(),
            headers: requestHeaders,
            body: requestPayload,
          },
          response: {
            status: response.status(),
            headers: responseHeaders,
            body: responseBody,
          },
        };
        fs.writeFileSync(logFilePath, JSON.stringify(logContent, null, 2), 'utf-8');
        console.log(`Log saved: ${logFilePath}`);
      } catch (error) {
        console.error('Failed to write log file:', error);
      }

      // Wait a moment after submission before moving to next record
      await page.waitForTimeout(2000);
      // const currentUrl = page.url();
      // expect(currentUrl).toContain('sales-invoice-list');

      // If we got responseData, write it to the CSV
      if (responseData !== null && responseData !== undefined) {
        await updateCsvColumn(index, 'insertStatus', String(responseData));
        await updateCsvColumn(index, 'status', 'success');
      }
      
      } catch (error: any) {
        console.error(`\n[ERROR] Test Row ${index + 1} failed or timed out: ${error.message}`);
        console.log(`Skipping to next record...`);
        await updateCsvColumn(index, 'status', 'skipped');
      }
    }
  });
});
