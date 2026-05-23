import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const stepWait = 2000;
const invoiceInputPath = path.resolve(process.cwd(), 'DataDriven', 'invoice-input.csv');

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
        partyName: row.partyName ?? '',
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
      };
    });
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
  const targetDate = toAppDate(csvDate);
  const { day, month, year } = getDateParts(csvDate);
  const dateTextbox = page.getByRole('textbox', { name: 'Sales Invoice Date' });
  const currentDateValue = await dateTextbox.inputValue();

  if (currentDateValue === targetDate) {
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

  const openCalendarButton = dateTextbox.locator('xpath=ancestor::mat-form-field[1]//button[@aria-label="Open calendar"]');
  await openCalendarButton.click();
  await waitForStep(page);

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

  if (await dayButton.isVisible()) {
    await dayButton.click();
  } else {
    await dayCellText.click();
  }

  await waitForStep(page);
  await expect(dateTextbox).toHaveValue(targetDate);
}

async function selectVisibleOption(page: Page, optionText: string | RegExp) {
  await waitForStep(page);
  await page.getByRole('option', { name: optionText }).click();
  await waitForStep(page);
}

async function selectVisibleOptionWithSearch(page: Page, searchText: string, optionText: string | RegExp) {
  await waitForStep(page);

  const panel = page.locator('.cdk-overlay-pane .mat-mdc-select-panel[role="listbox"]').last();
  await panel.waitFor({ state: 'visible', timeout: 30000 });

  const searchInput = panel.locator('input[aria-label="dropdown search"]').first();

  if (await searchInput.isVisible() && await searchInput.isEnabled()) {
    await searchInput.fill(searchText);
    await waitForStep(page);
  }

  await page.getByRole('option', { name: optionText }).click();
  await waitForStep(page);
}

async function selectPartyByCode(page: Page, partyCode: string) {
  const codePattern = new RegExp(`\\(C-${escapeRegExp(partyCode)}\\)`);
  await selectVisibleOptionWithSearch(page, `C-${partyCode}`, codePattern);
}

const invoiceInputs = loadInvoiceInputs();

/**
 * ===================================
 * TESTS
 * ===================================
 */

test.describe('Sales Invoice Automation', () => {
  test.setTimeout(300000);

  for (const [index, invoice] of invoiceInputs.entries()) {
    test(`Create Sales Invoice from CSV row ${index + 1}`, async ({ page }) => {
      await page.goto('https://hitechdairy.in/account-finance/transactions/sales-invoice-list');
      await page.waitForLoadState('networkidle');
      await waitForStep(page);

      const addInvoiceButton = page.getByRole('button', { name: 'Add Sales Invoice' });
      await addInvoiceButton.waitFor({ state: 'visible', timeout: 60000 });
      await addInvoiceButton.click();
      await waitForStep(page);

      // Select Unit Name
      await page.getByText('Select Unit Name').click();
      await selectVisibleOptionWithSearch(page, invoice.unitName, invoice.unitName);

      // Select Customer/Party Name
      await page.getByText('Select Customer/Party Name').click();
      await selectPartyByCode(page, invoice.partyName);

      // Set Sales Invoice Date
      await setSalesInvoiceDate(page, invoice.invoiceDate);

      // Select Sale Ledger
      await page.getByText('Select Sale Ledger').click();
      await selectVisibleOptionWithSearch(page, 'Gowardhan Sale Acc', 'Gowardhan Sale Acc');

      // Select Material and add to invoice
      await page.locator('#mat-mdc-form-field-label-20').getByText('Material Name').click();
      await selectVisibleOptionWithSearch(page, invoice.materialName.trim(), invoice.materialName.trim());

      // Set Quantity
      await page.locator('#mat-mdc-form-field-label-22').getByText('Quantity').click();
      await waitForStep(page);
      await page.getByRole('textbox', { name: 'Quantity' }).fill(invoice.quantity);
      await waitForStep(page);

      // Set Rate
      await page.getByRole('textbox', { name: 'Rate' }).click();
      await waitForStep(page);
      await page.getByRole('textbox', { name: 'Rate' }).fill(invoice.rate);
      await waitForStep(page);

      // Add item to invoice
      await page.getByRole('button', { description: 'add', exact: true }).click();
      await waitForStep(page);
      await page.getByRole('button', { name: 'Yes' }).click();
      await waitForStep(page);

      // Submit invoice
      await page.getByRole('button', { name: 'Submit' }).click();

      // Verify success
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      expect(currentUrl).not.toContain('add');
    });
  }
});
