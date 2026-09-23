// ─── Stealth browser strategy (Playwright) ──────────────────────────────
// Launches a headless Chromium with stealth hardening: automation flags
// removed, a coherent per-session fingerprint (UA + Client Hints pulled
// from fingerprint.ts — identical to the HTTP strategy's identity),
// realistic viewport/locale/timezone, and navigator.webdriver masked.
// Used as a fallback when plain HTTP is blocked, or when CRAWLER_MODE=browser.

import { crawlerConfig, proxyConfig } from '@/lib/config';
import { getImpersonate, sessionFingerprint } from './fingerprint';

// Playwright is a heavy dependency; import lazily so the app still boots
// if the browser binary isn't installed yet.
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const { chromium } = await import('playwright');
    // Route the browser through the first proxy in the pool (if any).
    const proxy = proxyConfig.pool[0];
    return chromium.launch({
      headless: true,
      proxy: proxy ? { server: proxy } : undefined,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        // Match the browser window to the viewport set on the context.
        '--window-size=1366,900',
        '--lang=en-US',
        '--no-first-run',
        '--no-default-browser-check',
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
 * Trigger Letterboxd's lazy-loaded posters (LazyPoster) and wait for a real
 * poster to appear. The initial HTML ships an empty placeholder
 * (`/static/img/empty-poster`); the real poster URL is only swapped in after
 * JS runs, so the browser must scroll (lazy images load near the viewport)
 * and then wait. The wait is ADAPTIVE — it returns as soon as a real poster
 * is present — and bounded by `crawlerConfig.posterWaitMs` so low-RAM hosts
 * like Render aren't pinned for longer than needed.
 *
 * Pages without poster images (profiles, following, lists) return
 * immediately.
 */
async function waitForPosters(page: Page): Promise<void> {
  // Nothing to wait for if the page has no poster images.
  const hasPosters = await page.evaluate(
    () => document.querySelectorAll('img.image, img.poster').length > 0,
  );
  if (!hasPosters) return;

  // Give React a moment to hydrate the LazyPoster components.
  await sleep(300);

  // Scroll through the page so lazy images load (they only fetch when near
  // the viewport). Cap the number of steps so huge pages don't stall.
  await page.evaluate(async (stepDelay) => {
    const step = window.innerHeight;
    const maxSteps = 40;
    let steps = 0;
    for (let y = 0; y < document.body.scrollHeight && steps < maxSteps; y += step, steps++) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, stepDelay));
    }
    window.scrollTo(0, 0);
  }, crawlerConfig.browserScrollDelayMs);

  // Wait until a real poster URL appears (the LazyPoster swaps the empty
  // placeholder for the real src). Stop as soon as one loads.
  const deadline = Date.now() + crawlerConfig.posterWaitMs;
  while (Date.now() < deadline) {
    const loaded = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img.image, img.poster'));
      return imgs.some((img) => {
        const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? '';
        return src && !src.includes('/static/img/empty-poster');
      });
    });
    if (loaded) break;
    await sleep(150);
  }
}

/**
 * Fetch a page's rendered HTML through a stealth browser session.
 * Returns null when the browser cannot be launched (e.g. binary missing).
 *
 * By default it waits for lazy-loaded posters so the returned HTML carries
 * real poster URLs. Pass `{ waitForPosters: false }` for pages where the
 * server-rendered markup already has what's needed (e.g. film pages, whose
 * poster lives in og:image) — this avoids holding the browser open on
 * memory-constrained hosts.
 */
export async function fetchHtmlStealth(
  url: string,
  opts: { waitForPosters?: boolean } = {},
): Promise<string | null> {
  let browser: Browser | null = null;
  try {
    browser = await getBrowser();
    // Share the HTTP strategy's session identity so the whole crawl presents
    // one coherent fingerprint: same UA + Client Hints across strategies.
    // Explicit client hints matter here — Chromium would otherwise send its
    // OWN build's sec-ch-ua (e.g. Chromium;v="128") next to our Chrome 131
    // UA, which is exactly the incoherence WAFs flag.
    const fp = sessionFingerprint(getImpersonate('letterboxd'));
    const context = await browser.newContext({
      userAgent: fp.userAgent,
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'dark',
      extraHTTPHeaders: {
        ...fp.commonHeaders,
        'Accept-Language': 'en-US,en;q=0.5',
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
    // Letterboxd lazy-loads posters — wait for them to appear so the
    // returned HTML carries real poster URLs (adaptive + bounded for
    // low-RAM hosts). Skipped when the caller only needs server-rendered
    // markup (e.g. film pages, whose poster is in og:image).
    if (opts.waitForPosters !== false) {
      await waitForPosters(page);
    }
    // Small human-like pause.
    await sleep(200 + Math.random() * 300);
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