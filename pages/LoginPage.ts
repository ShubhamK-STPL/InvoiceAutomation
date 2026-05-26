import { Page } from '@playwright/test';
import Tesseract from 'tesseract.js';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private getRequiredEnv(name: string) {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  private async solveCaptcha() {
    const captchaCanvas = this.page.locator('#captcha1');
    const captchaPath = 'captcha.png';
    await captchaCanvas.screenshot({ path: captchaPath });
    
    const result = await Tesseract.recognize(captchaPath, 'eng');
    const captchaText = result.data.text.replace(/[^a-zA-Z0-9]/g, '').trim();
    const trimmedCaptcha = captchaText.length > 1 ? captchaText.slice(1) : captchaText;
    
    console.log('OCR Captcha:', captchaText);
    console.log('Trimmed Captcha:', trimmedCaptcha);
    await this.page.getByRole('textbox', { name: 'Captcha' }).fill(trimmedCaptcha);
  }

  private async enterCredentials() {
    const username = this.getRequiredEnv('HITECH_USERNAME');
    const password = this.getRequiredEnv('HITECH_PASSWORD');
    
    const usernameInput = this.page.locator("//input[@formcontrolname='username']");
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.page.getByText('2026').waitFor({ state: 'visible', timeout: 15000 });
    
    await usernameInput.fill(username);
    await this.page.fill("//input[@formcontrolname='password']", password);
  }

  async loginWithRetry(maxRetries: number = 3) {
    let attempts = 0;
    let loginSuccess = false;

    while (attempts < maxRetries && !loginSuccess) {
      try {
        console.log(`Login attempt ${attempts + 1} of ${maxRetries}`);
        await this.page.goto('https://hitechdairy.in/login');
        
        await this.enterCredentials();
        
        await this.page.locator('#captcha1').click({ position: { x: 96, y: 15 } });
        await this.page.locator('#captcha1').waitFor({ state: 'visible' });
        
        await this.solveCaptcha();
        
        await this.page.getByRole('button', { name: 'Login' }).click();
        await this.waitForStep();
        await this.page.waitForTimeout(3000);
        
        const currentUrl = this.page.url();
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
        await this.page.waitForTimeout(2000);
      }
    }
  }
}
