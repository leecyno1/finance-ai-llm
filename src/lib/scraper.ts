import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { Mutex } from 'async-mutex';

type ScrapeResult = {
  title: string;
  url: string;
  content: string;
  metadata: {
    source: 'playwright';
    scrapedAt: string;
  };
};

class Scraper {
  private static browser: any | undefined;
  private static readonly IDLE_KILL_TIMEOUT = 30_000;
  private static readonly NAVIGATION_TIMEOUT = 20_000;
  private static idleTimeout: NodeJS.Timeout | undefined;
  private static browserMutex = new Mutex();
  private static userCount = 0;

  private static async initBrowser() {
    await this.browserMutex.runExclusive(async () => {
      if (!this.browser) {
        const { chromium } = await import('playwright');
        this.browser = await chromium.launch({
          headless: true,
          channel: 'chromium-headless-shell',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
          ],
        });
      }

      if (this.idleTimeout) clearTimeout(this.idleTimeout);
    });
  }

  private static scheduleIdleKill() {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);

    this.idleTimeout = setTimeout(async () => {
      await this.browserMutex.runExclusive(async () => {
        if (this.browser && this.userCount === 0) {
          await this.browser.close();
          this.browser = undefined;
        }
      });
    }, this.IDLE_KILL_TIMEOUT);
  }

  static async scrape(url: string): Promise<ScrapeResult> {
    await this.initBrowser();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    this.userCount += 1;

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.NAVIGATION_TIMEOUT,
      });
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(500);

      const html = await page.content();
      const dom = new JSDOM(html, { url });
      const content = new Readability(dom.window.document).parse();
      const title = (await page.title()) || content?.title || 'Untitled page';
      const text = String(content?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        title,
        url,
        content: `# ${title} - ${url}\n${text || 'No content available'}`,
        metadata: {
          source: 'playwright',
          scrapedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return {
        title: 'Failed to scrape',
        url,
        content: `# ${url}\n\nError scraping content.`,
        metadata: {
          source: 'playwright',
          scrapedAt: new Date().toISOString(),
        },
      };
    } finally {
      this.userCount -= 1;
      await context.close().catch(() => undefined);

      if (this.userCount === 0) {
        this.scheduleIdleKill();
      }
    }
  }
}

export type { ScrapeResult };
export default Scraper;
