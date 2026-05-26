import { chromium, FullConfig } from '@playwright/test';
import { loginWithRetry } from './tests/helpers/auth';
import fs from 'fs';

const statePath = 'storageState.json';
const protectedUrl = 'https://hitechdairy.in/account-finance/transactions/sales-invoice-list';

async function hasValidSession() {
  if (!fs.existsSync(statePath)) {
    console.log('storageState.json not found. Logging in.');
    return false;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();

  try {
    await page.goto(protectedUrl, { waitUntil: 'domcontentloaded' });

    const sessionState = await Promise.race([
      page.getByRole('button', { name: 'Add Sales Invoice' }).waitFor({ state: 'visible', timeout: 30000 }).then(() => 'valid'),
      page.getByRole('textbox', { name: 'Username' }).waitFor({ state: 'visible', timeout: 30000 }).then(() => 'expired'),
    ]);

    if (sessionState === 'valid') {
      console.log('Existing storageState.json is valid. Skipping login.');
      return true;
    }

    console.log('Existing storageState.json is expired. Logging in again.');
    return false;
  } catch (error) {
    console.log(`Could not validate storageState.json. Logging in again. ${error}`);
    return false;
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig) {
  if (await hasValidSession()) {
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await loginWithRetry(page, 3);
    await context.storageState({ path: statePath });
    console.log('Login complete. Saved fresh storageState.json.');
  } finally {
    await browser.close();
  }
}
