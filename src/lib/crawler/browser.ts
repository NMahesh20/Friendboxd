// ─── Stealth browser strategy (Playwright) ──────────────────────────────
// Launches a headless Chromium with stealth hardening: automation flags
// removed and a KNOWN-GOOD identity bundle shared with the HTTP strategy
// (Chrome/131 UA + forced Windows Client Hints from fingerprint.ts), plus a
// realistic viewport/locale/timezone and navigator.webdriver masked. Used as
// a fallback when plain HTTP is blocked, or when CRAWLER_MODE=browser.
//
// The browser is a LONG-LIVED background service: it launches once and holds
// a small pool of reusable tabs, so every URL fetch is just a navigation
// against the already-running process — DNS/TLS/HTTP stay warm and the crawl
// presents one consistent session. Because Letterboxd sits behind
// Cloudflare, which challenges sessions after bursts, the session CONTEXT is
// rotated periodically (or on a block) — the process stays warm, the
// identity/cookies go fresh, and one flagged session can't cascade into
// every later request. It self-heals (relaunches) if Chromium is killed
// (e.g. an OOM on a small host).
//
// Memory on small hosts (Render free ≈ 512MB): keep the tab pool tiny, block
// image/font/media downloads (the DOM src is all the crawl reads — saves
// ~140MB, measured), and close the whole browser after a quiet period
// (crawlerConfig.browserIdleTimeoutMs) so a finished crawl doesn't hold idle
// Chromium forever. The next request simply relaunches it (DNS/TLS/HTTP warm
// back up within one request).

import { crawlerConfig, proxyConfig } from '@/lib/config';
import { getImpersonate, sessionFingerprint } from './fingerprint';

// Playwright is a heavy dependency; import lazily so the app still boots
// if the browser binary isn't installed yet.
type Browser = import('playwright').Browser;
type BrowserContext = import('playwright').BrowserContext;
type Page = import('playwright').Page;

/**
 * Max tabs kept open in the background browser. Each open tab is a live
 * renderer holding a page (with lazily-loaded poster images), so keep the
 * pool small on low-RAM hosts — the rate limiter keeps concurrency polite,
 * so 2 tabs rarely stalls a crawl.
 */
const PAGE_POOL_SIZE = 2;

let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

interface PooledPage {
  page: Page;
  busy: boolean;
  lastUsed: number;
}
let pool: PooledPage[] = [];

// Context rotation: keep the browser PROCESS for warm DNS/TLS/tabs, but
// rotate the session context (fresh identity/cookies) when Letterboxd starts
// blocking or after steady use — a flagged long-lived session would otherwise
// cascade into every later request (the "sometimes blocked" symptom).
let contextRequests = 0;
let contextCreatedAt = 0;
let contextBlocked = false;
let lastRotationAt = 0;
let creatingContext: Promise<BrowserContext> | null = null;
/** Rotate after this many page navigations in one session. */
const CONTEXT_REQUEST_LIMIT = 60;
/** Sessions older than this are rotated too (restart with a clean identity). */
const CONTEXT_TTL_MS = 10 * 60 * 1000;
/**
 * Minimum gap between rotations — if the IP itself is flagged (datacenter
 * IPs on Render often are), every session is blocked; don't thrash.
 */
const MIN_ROTATION_GAP_MS = 30 * 1000;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const { chromium } = await import('playwright');
    // Route the browser through the first proxy in the pool (if any).
    const proxy = proxyConfig.pool[0];
    const browser = await chromium.launch({
      headless: true,
      proxy: proxy ? { server: proxy } : undefined,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        // Known-good from the setup that previously worked in production —
        // restore exactly these. (An experiment dropping these in favor of
        // "real Chromium" flags was flagged by Letterboxd's WAF on the first
        // request; evidence over theory, don't re-"fix" without deployment
        // proof.) Site isolation off also keeps renderer processes down,
        // which is the biggest browser-side memory lever.
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        // Match the browser window to the viewport set on the context.
        '--window-size=1366,900',
        '--lang=en-US',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    console.info(`[crawler] background browser running (${browser.version() ?? 'chromium'})`);
    return browser;
  })().catch((err) => {
    // Allow a retry on the next request instead of caching a rejected promise.
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

/** Create (once per rotation) the context that carries the session identity. */
async function getContext(): Promise<BrowserContext> {
  if (contextPromise) return contextPromise;
  if (!creatingContext) {
    // Guard concurrent creation (parallel crawl) so exactly one context is
    // built and the rest of the callers reuse it.
    creatingContext = (async () => {
      const browser = await getBrowser();
      // Share the HTTP strategy's session identity so the whole crawl
      // presents one coherent fingerprint: same UA + forced Client Hints as
      // curl-impersonate (Chrome/131 + Windows hints on the wire).
      // NOTE: a deliberate, KNOWN-GOOD config. An experiment replacing this
      // with Chromium's native hints + a Linux UA was flagged by Letterboxd's
      // WAF on the very first request — don't "fix" it again without
      // evidence from the actual deployment.
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
      // Memory: block image/font/media downloads. Letterboxd's lazy-poster JS
      // sets the real URL into the DOM even when the download fails, and the
      // crawler only reads the DOM src — so this saves ~140MB of decoded
      // images per crawl without changing results (verified locally).
      if (crawlerConfig.blockAssets) {
        await context.route('**/*', (route) => {
          const rt = route.request().resourceType();
          if (rt === 'image' || rt === 'font' || rt === 'media') return route.abort();
          return route.continue();
        });
      }
      // Mask automation signals on every page/navigation in this session.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] as unknown as PluginArray });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });
      // No front-page warm-up here — the previous production setup made the
      // first real request directly against the target URL and that's the
      // behavior that worked; keep it.
      contextCreatedAt = Date.now();
      contextRequests = 0;
      contextBlocked = false;
      contextPromise = Promise.resolve(context);
      return context;
    })().finally(() => {
      creatingContext = null;
    });
  }
  return creatingContext;
}

/**
 * Rotate the session: close the old context + its tabs, keep the browser
 * process warm. The next fetch builds a fresh context (clean cookies).
 */
function rotateContext(reason: string): void {
  pool = [];
  const cp = contextPromise;
  const wasRequests = contextRequests;
  contextPromise = null;
  contextRequests = 0;
  contextBlocked = false;
  lastRotationAt = Date.now();
  console.warn(`[crawler] rotating browser session (was ${wasRequests} requests): ${reason}`);
  void (async () => {
    if (!cp) return;
    try {
      const c = await cp;
      await c.close().catch(() => {});
    } catch {}
  })();
}

/** Why the current session should be replaced, or null when it's fine. */
function rotationReason(): string | null {
  if (Date.now() - lastRotationAt < MIN_ROTATION_GAP_MS) return null;
  if (contextBlocked) return 'block/challenge';
  if (contextRequests >= CONTEXT_REQUEST_LIMIT) return `request cap (${contextRequests})`;
  if (contextCreatedAt > 0 && Date.now() - contextCreatedAt >= CONTEXT_TTL_MS) return 'session TTL';
  return null;
}

/**
 * Force a session rotation now (used when the HTTP strategy gets blocked and
 * the browser fallback needs a clean identity). Rate-limited by the same
 * minimum gap so a hard IP block can't thrash contexts.
 */
export function rotateBrowserSession(): void {
  if (Date.now() - lastRotationAt >= MIN_ROTATION_GAP_MS) {
    rotateContext('forced (HTTP blocked)');
  }
}

/** Drop the running browser + pool; the next fetch relaunches fresh. */
function resetBrowser(reason = 'reset'): void {
  pool = [];
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const bp = browserPromise;
  browserPromise = null;
  contextPromise = null;
  contextRequests = 0;
  contextBlocked = false;
  contextCreatedAt = 0;
  lastActivityAt = Date.now();
  console.info(`[crawler] browser closed (${reason}); will relaunch on next fetch`);
  void (async () => {
    if (!bp) return;
    try {
      const b = await bp;
      await b.close().catch(() => {});
    } catch {}
  })();
}

export async function closeBrowser(): Promise<void> {
  resetBrowser('explicit close');
}

// ─── Idle shutdown ───────────────────────────────────────────────────────
// A warm Chromium holds ~200-400MB; on small hosts (Render free ≈ 512MB)
// that's most of the service budget on top of the Next.js process. Close the
// browser after a quiet period so a finished crawl doesn't hold the memory
// forever — the next request simply relaunches it (DNS/TLS/HTTP warm back up
// within one request).
let lastActivityAt = Date.now();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function recheckIdle(): void {
  const idleMs = Date.now() - lastActivityAt;
  if (idleMs >= crawlerConfig.browserIdleTimeoutMs) {
    idleTimer = null;
    console.info(
      `[crawler] browser idle ${Math.floor(idleMs / 1000)}s — closing to free memory`,
    );
    resetBrowser();
    return;
  }
  idleTimer = setTimeout(recheckIdle, crawlerConfig.browserIdleTimeoutMs - idleMs);
  idleTimer.unref?.();
}

/** Note a browser fetch so the idle timer doesn't tear the browser down mid-crawl. */
function touchActivity(): void {
  lastActivityAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (crawlerConfig.browserIdleTimeoutMs <= 0) return; // disabled
  idleTimer = setTimeout(recheckIdle, crawlerConfig.browserIdleTimeoutMs);
  idleTimer.unref?.();
}

/**
 * Grab a tab from the pool — reusing an idle one, or opening a new tab when
 * under the cap. If every tab is busy (parallel crawl), wait briefly; the
 * rate limiter keeps concurrency polite, so this rarely stalls.
 */
async function acquirePage(): Promise<Page> {
  // Rotate the session before grabbing a tab if it has been flagged (a page
  // got an HTTP 403 from Letterboxd), served many requests, or aged out.
  const reason = rotationReason();
  if (reason) rotateContext(reason);
  const context = await getContext();
  contextRequests++;
  const deadline = Date.now() + crawlerConfig.timeoutMs;
  for (;;) {
    // Drop tabs the browser closed on its own (crashes, external closes).
    pool = pool.filter((p) => !p.page.isClosed());
    const idle = pool.find((p) => !p.busy);
    if (idle) {
      idle.busy = true;
      idle.lastUsed = Date.now();
      return idle.page;
    }
    if (pool.length < PAGE_POOL_SIZE) {
      const page = await context.newPage();
      // Flag the session if Letterboxd blocks a request in this context so
      // we rotate to a fresh identity instead of letting one flagged session
      // cascade into every later request.
      page.on('response', (resp) => {
        if (resp.status() === 403 && resp.url().includes('letterboxd.com')) {
          contextBlocked = true;
        }
      });
      pool.push({ page, busy: true, lastUsed: Date.now() });
      return page;
    }
    if (Date.now() >= deadline) {
      throw new Error('browser tab pool busy (all open tabs in use)');
    }
    await sleep(60);
  }
}

/** Return a tab to the pool so the next fetch can reuse it. */
function releasePage(page: Page): void {
  const entry = pool.find((p) => p.page === page);
  if (entry) entry.busy = false;
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
 * Fetch a page's rendered HTML through the long-lived stealth browser.
 * Returns null when the browser cannot be launched (e.g. binary missing).
 *
 * Each call reuses a WARM tab from the background browser instead of
 * launching/tearing down a fresh context — the browser process stays up
 * between requests and self-heals if it dies (e.g. an OOM on a small host).
 *
 * By default it waits for lazy-loaded posters so the returned HTML carries
 * real poster URLs. Pass `{ waitForPosters: false }` for pages where the
 * server-rendered markup already has what's needed (e.g. film pages, whose
 * poster lives in og:image) — this avoids waiting on memory-constrained
 * hosts.
 */
export async function fetchHtmlStealth(
  url: string,
  opts: { waitForPosters?: boolean } = {},
): Promise<string | null> {
  // Keep the browser alive for the duration of the crawl (and restart the
  // idle countdown after each fetch).
  touchActivity();
  // A session flagged by a previous crawl can fail the FIRST fetch of the
  // next one too, so when a block page is served, rotate once and retry with
  // a fresh identity before giving up.
  let attempt = 0;
  for (;;) {
    const { html, retry } = await attemptFetch(url, opts);
    if (!retry) return html;
    if (++attempt >= 2) {
      console.warn('[crawler] browser kept serving a block/challenge page:', url);
      return null;
    }
    rotateBrowserSession();
    // Cloudflare block cooldown: a fresh session right after a challenge is
    // usually still blocked for a few seconds, so wait before retrying.
    await sleep(5000 + Math.random() * 2000);
  }
}

/** One browser fetch attempt; `retry: true` means the page was a Cloudflare-style block. */
async function attemptFetch(
  url: string,
  opts: { waitForPosters?: boolean },
): Promise<{ html: string | null; retry: boolean }> {
  let page: Page | null = null;
  try {
    page = await acquirePage();
    // Chromium may have been killed since the last call (Render OOM-kills
    // the browser first). Detect it and retry once with a fresh process.
    const b = page.context().browser();
    if (b && !b.isConnected()) {
      resetBrowser();
      page = await acquirePage();
    }
    const resp = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: crawlerConfig.timeoutMs,
    });
    // Letterboxd is behind Cloudflare: after a burst of requests the next
    // page comes back as a terse "Just a moment..." 403 challenge. Playwright
    // does NOT throw on HTTP 403, so without this check the challenge HTML
    // would be parsed as an empty result — silently killing a crawl. Treat it
    // as a block: the caller retries once with a rotated session, and the
    // session flag rotates it again before any later fetch.
    if (resp?.status() === 403) {
      contextBlocked = true;
      return { html: null, retry: true };
    }
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
    // A 200-status challenge page also exists. Real Letterboxd pages embed
    // /cdn-cgi/challenge-platform/... scripts (Cloudflare injects those into
    // EVERY proxied page), so the ONLY reliable signs are HTTP 403 or the
    // challenge's own copy ("Just a moment" title, "checking your browser").
    if (
      resp?.status() === 403 ||
      /<title[^>]*>\s*just a moment/i.test(html) ||
      /checking your browser before accessing|cf-challenge-running/i.test(html)
    ) {
      contextBlocked = true;
      return { html: null, retry: true };
    }
    return { html, retry: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Browser process died? Relaunch on the next fetch instead of reusing
    // stale pages. A healthy-but-closed page/context (rotation, tab crash)
    // must NOT reset the browser — that would kill it unnecessarily.
    if (browserPromise) {
      try {
        const b = await browserPromise;
        if (!b.isConnected()) {
          resetBrowser();
          console.warn('[crawler] background browser died; will relaunch on next fetch:', msg);
          return { html: null, retry: false };
        }
      } catch {
        resetBrowser();
        console.warn('[crawler] background browser gone; will relaunch on next fetch:', msg);
        return { html: null, retry: false };
      }
    }
    // Page-level failure (navigation stall, blocked/slow page, memory
    // pressure on small hosts) — salvage whatever DOM exists, then retire
    // this tab. Film pages ship their poster (og:image) + average rating in
    // the initial server-rendered HTML, so a stalled page still yields them.
    if (page && !page.isClosed()) {
      let partial = '';
      try {
        partial = await page.content();
      } catch {}
      await page.close().catch(() => {});
      if (partial.trim()) {
        console.warn('[crawler] stealth navigation stalled; kept partial HTML:', msg);
        return { html: partial, retry: false };
      }
    }
    console.warn('[crawler] stealth browser fetch failed:', msg);
    return { html: null, retry: false };
  } finally {
    // Return the tab to the pool — never close it; the next fetch reuses it.
    if (page && !page.isClosed()) releasePage(page);
  }
}