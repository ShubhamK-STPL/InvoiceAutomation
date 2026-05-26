import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private logDir: string;

  constructor() {
    this.logDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  async logFailure(page: Page, identifier: string, errorMsg: string, requestData?: any, responseData?: any) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Sanitize identifier for file paths
    const safeId = identifier.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const baseName = `${safeId}_failed_${timestamp}`;
    
    // Capture screenshot
    try {
      const screenshotPath = path.resolve(this.logDir, `${baseName}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`[LOGGER] Screenshot saved to: logs/${baseName}.png`);
    } catch (e) {
      console.error(`[LOGGER] Failed to capture screenshot:`, e);
    }
    
    // Save API and error logs
    try {
      const logData = {
        identifier,
        timestamp: new Date().toISOString(),
        error: errorMsg,
        url: page.url(),
        requestData: requestData || 'No API request intercepted',
        responseData: responseData || 'No API response intercepted',
      };
      
      const logPath = path.resolve(this.logDir, `${baseName}.json`);
      fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf-8');
      console.error(`[LOGGER] API/Error log saved to: logs/${baseName}.json`);
    } catch (e) {
      console.error(`[LOGGER] Failed to write log file:`, e);
    }
    
    console.error(`\n[LOGGER] Failure recorded for: ${identifier}\n`);
  }
}
