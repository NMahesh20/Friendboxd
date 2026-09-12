// ─── Stealth browser strategy (Playwright) ──────────────────────────────
// Launches a headless Chromium with stealth hardening: automation flags
// removed, realistic UA/viewport/locale, and navigator.webdriver masked.
// Used as a fallback when plain HTTP is blocked, or when CRAWLER_MODE=browser.

import { crawlerConfig } from '@/lib/config';

// Playwright is a heavy dependency; import lazily so the app still boots
// if the browser binary isn't installed yet.
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const { chromium } = await import('playwright');
    return chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
  })().catch((err) => {
    // Allow a retry on the next request instead of caching a rejected promise.
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close().catch(() => {});
    browserPromise = null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a page's rendered HTML through a stealth browser session.
 * Returns null when the browser cannot be launched (e.g. binary missing).
 */
export async function fetchHtmlStealth(url: string): Promise<string | null> {
  let browser: Browser | null = null;
  try {
    browser = await getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'dark',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    // Mask automation signals.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] as unknown as PluginArray });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    const page: Page = await context.newPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: crawlerConfig.timeoutMs,
    });
    // Small human-like pause.
    await sleep(400 + Math.random() * 600);
    const html = await page.content();
    await context.close();
    return html;
  } catch (err) {
    console.warn('[crawler] stealth browser fetch failed:', (err as Error).message);
    return null;
  } finally {
    // Keep the browser alive for reuse across requests in a session.
    void browser;
  }
}