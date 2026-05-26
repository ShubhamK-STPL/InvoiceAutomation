import { Page } from '@playwright/test';

export class BasePage {
  protected page: Page;
  protected stepWait = 400;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForStep() {
    await this.page.waitForTimeout(this.stepWait);
  }

  protected escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async selectVisibleOption(optionText: string | RegExp) {
    await this.waitForStep();
    await this.page.getByRole('option', { name: optionText }).click();
    await this.waitForStep();
  }

  async selectVisibleOptionWithSearch(searchText: string, optionText: string | RegExp) {
    console.log(`[selectVisibleOptionWithSearch] Started. Search text: "${searchText}", Option text: "${optionText}"`);
    await this.waitForStep();

    console.log(`[selectVisibleOptionWithSearch] Locating search input...`);
    const searchInput = this.page.locator("xpath=//input[@type='text' and contains(@placeholder,'Search') and not(@placeholder='Search Page Name')]").last();
    
    console.log(`[selectVisibleOptionWithSearch] Waiting for search input to be visible...`);
    await searchInput.waitFor({ state: 'visible', timeout: 30000 });
    
    console.log(`[selectVisibleOptionWithSearch] Typing search text: "${searchText}"...`);
    await searchInput.pressSequentially(searchText, { delay: 50 });
    await this.waitForStep();

    console.log(`[selectVisibleOptionWithSearch] Clicking option matching: "${optionText}"...`);
    await this.page.getByRole('option', { name: optionText }).click();
    
    console.log(`[selectVisibleOptionWithSearch] Finished successfully.`);
    await this.waitForStep();
  }
}
