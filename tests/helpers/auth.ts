import { Page } from '@playwright/test';
import Tesseract from 'tesseract.js';

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function solveCaptcha(page: Page) {
  const captchaCanvas = page.locator('#captcha1');
  const captchaPath = 'captcha.png';
  await captchaCanvas.screenshot({ path: captchaPath });
  const result = await Tesseract.recognize(captchaPath, 'eng');
  const captchaText = result.data.text.replace(/[^a-zA-Z0-9]/g, '').trim();
  const trimmedCaptcha = captchaText.length > 1 ? captchaText.slice(1) : captchaText;
  console.log('OCR Captcha:', captchaText);
  console.log('Trimmed Captcha:', trimmedCaptcha);
  await page.getByRole('textbox', { name: 'Captcha' }).fill(trimmedCaptcha);
}

export async function verifyLoginPageAndEnterCredentials(page: Page) {
  const username = getRequiredEnv('HITECH_USERNAME');
  const password = getRequiredEnv('HITECH_PASSWORD');
  const usernameInput = page.locator("//input[@formcontrolname='username']");
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await page.getByText('2026').waitFor({ state: 'visible', timeout: 15000 });
  await usernameInput.fill(username);
  await page.fill("//input[@formcontrolname='password']", password);
}

export async function loginWithRetry(page: Page, maxRetries: number = 3) {
  let attempts = 0;
  let loginSuccess = false;

  while (attempts < maxRetries && !loginSuccess) {
    try {
      console.log(`Login attempt ${attempts + 1} of ${maxRetries}`);
      await page.goto('https://hitechdairy.in/login');
      await verifyLoginPageAndEnterCredentials(page);
      await page.locator('#captcha1').click({ position: { x: 96, y: 15 } });
      await page.locator('#captcha1').waitFor({ state: 'visible' });
      await solveCaptcha(page);
      await page.getByRole('button', { name: 'Login' }).click();
      await page.waitForTimeout(3000);
      const currentUrl = page.url();
      if (currentUrl.includes('account-finance') || !currentUrl.includes('login')) {
        loginSuccess = true;
        console.log('Login successful!');
      } else {
        throw new Error('Login page still visible, login may have failed');
      }
    } catch (error) {
      attempts++;
      console.log(`Login attempt failed: ${error}`);
      if (attempts >= maxRetries) {
        throw new Error(`Login failed after ${maxRetries} attempts`);
      }
      await page.waitForTimeout(2000);
    }
  }
}
