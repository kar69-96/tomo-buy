import { chromium, type Browser, type Page } from 'playwright';
import { ExecutorError } from '@tomo/core';
import type { BrowserDriver, FieldDescriptor } from './driver.js';

/**
 * Live browser driver — local headless Chrome via Playwright.
 *
 * (Deviation from the runbook, at the user's instruction: the phase file named a
 * Browserbase driver; we drive local headless Chrome instead. Same trust
 * boundary — the atomic swap runs in-page and real values never cross back to
 * Node.)
 *
 * Launch prefers the system Google Chrome channel; if that is unavailable it
 * falls back to Playwright's bundled Chromium.
 */
export class PlaywrightDriver implements BrowserDriver {
  private browser?: Browser;
  private page?: Page;

  constructor(private readonly headless: boolean = true) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    try {
      this.browser = await chromium.launch({ channel: 'chrome', headless: this.headless });
    } catch {
      this.browser = await chromium.launch({ headless: this.headless });
    }
    this.page = await this.browser.newPage();
    return this.page;
  }

  async goto(url: string): Promise<void> {
    const page = await this.ensurePage();
    await page.goto(url);
  }

  async setContent(html: string): Promise<void> {
    const page = await this.ensurePage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
  }

  async discoverFields(): Promise<FieldDescriptor[]> {
    const page = await this.ensurePage();
    return page.$$eval('input[name], textarea[name], select[name]', (els) =>
      els.map((el) => {
        const name = el.getAttribute('name') ?? '';
        return { selector: `[name="${name}"]`, name };
      }),
    );
  }

  async fillField(selector: string, marker: string): Promise<void> {
    const page = await this.ensurePage();
    await page.fill(selector, marker);
  }

  async evaluateSwap(scriptString: string, swapMap: Record<string, string>): Promise<void> {
    const page = await this.ensurePage();
    // Run the VERBATIM atomic-swap script in-page. eval turns the script string
    // back into the arrow function and invokes it with the swap map. Real values
    // exist only here, inside the page, for milliseconds.
    await page.evaluate(
      ({ script, map }) => {
        // eslint-disable-next-line no-eval
        const fn = eval(script) as (m: Record<string, string>) => void;
        fn(map);
      },
      { script: scriptString, map: swapMap },
    );
  }

  async readValue(selector: string): Promise<string> {
    const page = await this.ensurePage();
    return page.inputValue(selector);
  }

  async getPageText(): Promise<string> {
    const page = await this.ensurePage();
    return page.innerText('body');
  }

  async close(): Promise<void> {
    try {
      await this.page?.close();
      await this.browser?.close();
    } catch (cause) {
      throw new ExecutorError('Failed to close browser session.', { cause });
    } finally {
      this.page = undefined;
      this.browser = undefined;
    }
  }
}
