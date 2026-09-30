// ─── Captcha-solver browser strategy (Playwright + solver extension) ─────
//
// A second browser strategy, tried BEFORE the plain stealth browser when
// CRAWLER_CAPTCHA_SOLVER=1. It runs a full Chromium with the unpacked solver
// extension loaded, and when a page turns out to be a challenge it hands the
// live tab to the extension and waits for it to defeat the captcha.
//
// Why a whole separate strategy instead of an option on browser.ts: the
// extension only completes a solve under launchPersistentContext. With
// chromium.launch() + newContext() the extension's service worker starts but
// never finishes — measured 0 solves in 4 runs vs 4/4 with a persistent
// context (65s, 81s, 102s, 142s). A persistent context also owns the browser
// process, so it cannot coexist with browser.ts's warm-process + rotating-
// context design. Keeping them apart means the proven stealth path is
// untouched and the solver can be switched off with one env var.
//
// The extension does NOT click the captcha checkbox — it only handles the
// challenge the provider issues on its own. So this module never drives the
// widget either: solveChallenge() only reads the page, and treats the challenge
// as cleared once the document stops reading as one. Synthesized input would
// itself be a signal, and nothing here needs it.
//
// Session handling: a solve here is worth KEEPING. The context stays open with
// its cf_clearance cookie and is reused for every later request, and callers
// are expected not to rotate the plain stealth browser's session on the
// strength of a challenge this browser already handled (see fetchViaBrowser in
// letterboxd.ts). Only the idle timeout or an explicit close tears it down.
//
// Memory: one context, one tab, torn down after crawlerConfig's idle window,
// with the on-disk profile deleted alongside it.

import { existsSync, rmSync } from "node:fs";
import { crawlerConfig, proxyConfig } from "@/lib/config";
import { extraHeaders, NATIVE_UA, stealthInitScript } from "./browser-identity";

type BrowserContext = import("playwright").BrowserContext;
type Page = import("playwright").Page;
type Frame = import("playwright").Frame;

/** Where the Dockerfile unpacks solver.crx; set by EXTENSION_DIR. */
const EXTENSION_DIR = process.env.EXTENSION_DIR || "/tmp/ext";

/** The extension is the whole point — without it there's nothing to run. */
const HAS_EXTENSION =
  existsSync(EXTENSION_DIR) && existsSync(`${EXTENSION_DIR}/manifest.json`);

/**
 * Whether this strategy should run at all. Both conditions matter: the flag is
 * the operator's choice, and the extension has to physically exist (local dev
 * and INSTALL_BROWSER=0 images have none).
 */
export const captchaEnabled = crawlerConfig.captchaSolver && HAS_EXTENSION;

let contextPromise: Promise<BrowserContext> | null = null;
let profileInUse = false;
let lastActivityAt = Date.now();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** The captcha widget lives in a cross-origin iframe, never the top document. */
const CAPTCHA_HOST = "recaptcha";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch (once) the persistent Chromium that carries the extension.
 *
 * launchPersistentContext is load-bearing, not stylistic: it's the only mode in
 * which the solver extension completes a challenge. Keep the args in sync with
 * scripts/recaptcha-solver-test.mjs — that script is the integration probe for
 * exactly this configuration.
 */
async function getContext(): Promise<BrowserContext> {
  if (contextPromise) return contextPromise;
  if (profileInUse) {
    // The previous profile is still being deleted; give it a beat rather than
    // racing Chromium for the directory.
    await sleep(250);
  }
  contextPromise = (async () => {
    const { chromium } = await import("playwright");
    const proxy = proxyConfig.pool[0];
    const context = await chromium.launchPersistentContext(
      crawlerConfig.captchaProfileDir,
      {
        headless: true,
        // Full Chromium, not Playwright's default chromium-headless-shell,
        // which silently ignores --load-extension.
        channel: "chromium",
        proxy: proxy ? { server: proxy } : undefined,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--headless=new",
          // NOT --disable-gpu: that forces ANGLE onto SwiftShader, and a
          // software renderer is one of the strongest bot signals reCAPTCHA
          // scores. Prefer a real GL backend and fall back to SwiftShader only
          // when the host has none (stealthInitScript also reports a desktop
          // GPU, since a container has no honest one to report).
          "--use-gl=angle",
          "--use-angle=gl",
          "--window-size=1366,900",
          "--no-first-run",
          "--no-default-browser-check",
          `--disable-extensions-except=${EXTENSION_DIR}`,
          `--load-extension=${EXTENSION_DIR}`,
        ],
        // Native Chromium identity: the binary reports its own brand list,
        // platform and GPU, so the UA override only has to strip the
        // "Headless" token. Claiming a different Chrome version here is what
        // made the wire and the page contradict each other — see
        // browser-identity.ts.
        userAgent: NATIVE_UA,
        extraHTTPHeaders: extraHeaders(),
        viewport: { width: 1366, height: 900 },
        colorScheme: "dark",
        timezoneId: "Asia/Kolkata",
      },
    );
    await context.addInitScript(stealthInitScript);
    profileInUse = true;
    console.info(
      `[crawler] captcha browser running (${context.browser()?.version() ?? "chromium"}) with solver extension from ${EXTENSION_DIR}`,
    );
    return context;
  })().catch((err) => {
    // Let the next request retry instead of caching a rejected promise.
    contextPromise = null;
    throw err;
  });
  return contextPromise;
}

/**
 * Block heavy assets to save memory, but let the captcha widget's own images
 * through. reCAPTCHA serves its challenge tiles as <img class="rc-image-tile">
 * from google.com/recaptcha/api2/payload; abort them and the extension has
 * nothing to classify, so the solve can never finish no matter how long we
 * wait. This is the one place blockAssets and captchaSolver disagree, and
 * captchaSolver wins for those hosts.
 */
async function applyAssetBlocking(context: BrowserContext): Promise<void> {
  if (!crawlerConfig.blockAssets) return;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes(CAPTCHA_HOST) || url.includes("gstatic.com/recaptcha")) {
      return route.continue();
    }
    const type = route.request().resourceType();
    if (type === "image" || type === "font" || type === "media") {
      return route.abort();
    }
    return route.continue();
  });
}

/** True while the tab is showing a Cloudflare "Just a moment" interstitial. */
function isChallengeHtml(html: string): boolean {
  return (
    /<title[^>]*>\s*just a moment/i.test(html) ||
    /checking your browser before accessing|cf-challenge-running/i.test(html)
  );
}

/**
 * Poll the tab until the challenge is gone, then return the real page HTML.
 * Returns null if the wait window runs out, and the caller then falls back to
 * the plain stealth browser.
 *
 * Purely observational: nothing is clicked, focused or key-pressed, so nothing
 * here can be a synthetic-input signal. The extension is left to do its work
 * against whatever challenge the provider serves, and this just watches for the
 * page to come back.
 *
 * "Cleared" is one condition: the document no longer reads as a challenge. That
 * covers both shapes on its own — an interstitial reloads into the real page,
 * and an embedded widget re-renders its host once the token is issued. Main
 * frame navigations are counted so the log can distinguish the two.
 */
async function solveChallenge(page: Page): Promise<string | null> {
  let reloads = 0;
  // Subframe navigations are noise — the recaptcha iframe reloads constantly.
  const countReload = (frame: Frame) => {
    if (frame === page.mainFrame()) reloads += 1;
  };
  page.on("framenavigated", countReload);

  console.warn(
    `[crawler] challenge detected — watching for up to ${Math.round(
      crawlerConfig.captchaWaitMs / 1000,
    )}s without touching the page`,
  );

  const deadline = Date.now() + crawlerConfig.captchaWaitMs;
  try {
    while (Date.now() < deadline) {
      await sleep(2000);
      if (page.isClosed()) return null;

      let html = "";
      try {
        html = await page.content();
      } catch {
        // Mid-navigation: the document is mid-replacement, nothing to read yet.
        continue;
      }
      if (!html || isChallengeHtml(html)) continue;

      console.info(
        reloads > 0
          ? `[crawler] challenge cleared — page reloaded ${reloads}x into the real page`
          : "[crawler] challenge cleared — continuing with the real page",
      );
      return html;
    }
    console.warn(
      "[crawler] challenge did not clear within the wait window; falling back to stealth browser",
    );
    return null;
  } finally {
    page.off("framenavigated", countReload);
  }
}

/** Reset the idle countdown so a crawl in flight can't be torn down. */
function touchActivity(): void {
  lastActivityAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (crawlerConfig.browserIdleTimeoutMs <= 0) return;
  idleTimer = setTimeout(recheckIdle, crawlerConfig.browserIdleTimeoutMs);
  idleTimer.unref?.();
}

function recheckIdle(): void {
  const idleMs = Date.now() - lastActivityAt;
  if (idleMs >= crawlerConfig.browserIdleTimeoutMs) {
    idleTimer = null;
    console.info(
      `[crawler] captcha browser idle ${Math.floor(idleMs / 1000)}s — closing to free memory`,
    );
    void closeCaptchaBrowser("idle");
    return;
  }
  idleTimer = setTimeout(
    recheckIdle,
    crawlerConfig.browserIdleTimeoutMs - idleMs,
  );
  idleTimer.unref?.();
}

/**
 * Close the captcha browser and delete its profile. A persistent context can't
 * be closed while keeping the process warm (it owns it), so this is a full
 * teardown — the next fetch relaunches.
 */
export async function closeCaptchaBrowser(
  reason = "explicit close",
): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const cp = contextPromise;
  contextPromise = null;
  console.info(
    `[crawler] captcha browser closed (${reason}); will relaunch on next fetch`,
  );
  if (cp) {
    try {
      await (await cp).close();
    } catch {}
  }
  // The profile carries Chromium caches worth hundreds of MB; don't leave it.
  if (profileInUse) {
    profileInUse = false;
    try {
      rmSync(crawlerConfig.captchaProfileDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Fetch a page through the captcha-solver browser. Returns null when this
 * strategy can't produce usable HTML, so the caller can fall back to the plain
 * stealth browser.
 *
 * The browser is torn down whenever it fails. Holding it open after a failed
 * challenge is actively harmful: the tab is parked on a challenge page, so every
 * later fetch reuses a poisoned tab and burns the full wait window again on a
 * challenge we already know this session can't beat. Closing also releases the
 * Chromium and its several-hundred-MB profile before the fallback browser
 * starts, which matters on the small hosts this runs on.
 *
 * A SUCCESSFUL solve is the opposite case and is deliberately kept: that
 * session just earned its clearance cookie, so the context and its tab stay
 * warm for every later request (see the session handling note at the top).
 *
 * Deliberately narrower than fetchHtmlStealth: no session rotation, no poster
 * waiting. Its only job is to out-wait a captcha the cheaper strategy couldn't
 * clear.
 */
export async function fetchHtmlWithCaptcha(
  url: string,
  opts: { waitForPosters?: boolean } = {},
): Promise<string | null> {
  if (!captchaEnabled) return null;
  touchActivity();
  // Only re-arm the idle countdown if the browser is still standing at the end.
  let kept = false;
  try {
    const context = await getContext();
    // launchPersistentContext opens a page up front; reuse it rather than
    // adding a second tab (each tab is a live renderer holding memory).
    const page = context.pages()[0] ?? (await context.newPage());
    await applyAssetBlocking(context);

    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: crawlerConfig.timeoutMs,
    });

    // Playwright does NOT throw on a 403, so without this the challenge HTML
    // would be parsed as an empty result and silently kill the crawl.
    if (resp?.status() === 403 || isChallengeHtml(await page.content())) {
      const solved = await solveChallenge(page);
      if (!solved) {
        await closeCaptchaBrowser("challenge outlived the wait window");
        return null;
      }
      kept = true;
      return solved;
    }
    kept = true;
    return await page.content();
  } catch (err) {
    console.warn(
      "[crawler] captcha browser fetch failed:",
      err instanceof Error ? err.message : err,
    );
    // A launch or navigation failure leaves the context unusable too.
    await closeCaptchaBrowser("fetch failed");
    return null;
  } finally {
    if (kept) touchActivity();
  }
}
