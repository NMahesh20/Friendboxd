/**
 * ─── Captcha solver extension smoke test ────────────────────────────────
 * Opens a reCAPTCHA v2 widget in the SAME Chromium configuration the
 * captcha-solver crawler strategy uses, clicks the checkbox, and waits for the
 * solver extension to tick it.
 *
 * The only assertion is that `#recaptcha-anchor` ends up `aria-checked="true"`.
 * That only happens if the unpacked extension loaded and defeated the
 * challenge Google issued, which is the whole point of shipping it.
 *
 * This is an integration probe, not a unit test: it needs network access and a
 * real Chromium, so it runs as its own CI job rather than in `npm test`.
 *
 * ── How to run ──────────────────────────────────────────────────────────
 * Needs the Docker image (it carries Chromium + the unpacked extension), so
 * run it inside a container built from the repo root:
 *
 *   docker build -t friendboxd:test .
 *   docker run --rm --network host \
 *     -v "$PWD/scripts:/app/scripts:ro" \
 *     --entrypoint node friendboxd:test \
 *     /app/scripts/recaptcha-solver-test.mjs
 *
 * Add `-e SOLVER_TEST_SHOT_DIR=/shots` with `-v "$PWD/shots:/shots"` to get a
 * screenshot every 10 seconds — that's how you diagnose a run that times out.
 *
 * Takes 60-150s. Exit codes: 0 = solved, 1 = not solved, 2 = misconfigured.
 *
 * Env:
 *   EXTENSION_DIR          unpacked extension dir (default /tmp/ext)
 *   SOLVER_TEST_URL        page to open (default Google's reCAPTCHA demo)
 *   SOLVER_TEST_TIMEOUT_MS how long to wait for the tick (default 180000)
 *   SOLVER_TEST_SHOT_DIR   screenshot dir (one every 10s while waiting)
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const EXTENSION_DIR = process.env.EXTENSION_DIR || "/tmp/ext";
const TARGET_URL =
  process.env.SOLVER_TEST_URL || "https://www.google.com/recaptcha/api2/demo";
// The solver grinds through several rounds of tile swapping before it wins;
// measured 65-145s on real runs, so keep generous headroom over the slowest.
const TIMEOUT_MS = Number(process.env.SOLVER_TEST_TIMEOUT_MS || 180000);
const SHOT_INTERVAL_MS = 10000;
const SHOT_DIR = process.env.SOLVER_TEST_SHOT_DIR || null;
const PROFILE_DIR = join(tmpdir(), "solver-test-profile");

// The solver can only prove itself if the extension is actually present.
if (!existsSync(EXTENSION_DIR)) {
  console.error(
    `FAIL: extension dir ${EXTENSION_DIR} does not exist — nothing to test.`,
  );
  process.exit(2);
}
if (!existsSync(`${EXTENSION_DIR}/manifest.json`)) {
  console.error(
    `FAIL: no manifest.json in ${EXTENSION_DIR} — the .crx unpack failed.`,
  );
  process.exit(2);
}

// Keep in sync with getContext() in src/lib/crawler/captcha-browser.ts. Two
// things are load-bearing for extensions: Playwright's default headless is the
// `chromium-headless-shell` build, which silently ignores --load-extension, so
// the full Chromium build (channel: "chromium") + new headless mode are
// required. launchPersistentContext is used rather than launch + newContext
// because it is the only launch mode in which the solver extension actually
// completes a challenge — under launch + newContext the extension's service
// worker starts but the widget never ticks (0/4 vs 4/4).
const args = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--headless=new",
  "--disable-gpu",
  "--disable-features=IsolateOrigins,site-per-process",
  "--window-size=1366,900",
  "--lang=en-US",
  "--no-first-run",
  "--no-default-browser-check",
  `--disable-extensions-except=${EXTENSION_DIR}`,
  `--load-extension=${EXTENSION_DIR}`,
];

// The widget lives in a cross-origin iframe (…/recaptcha/api2/anchor), so
// nothing reachable from the top-level page can see it. Every lookup below goes
// through page.frames() rather than page.waitForSelector / page.evaluate.
const CHECKBOX = "#recaptcha-anchor";
const anchorFrame = (page) =>
  page.frames().find((f) => f.url().includes("/recaptcha/api2/anchor"));

async function waitForAnchor(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = anchorFrame(page);
    if (frame && (await frame.locator(CHECKBOX).count().catch(() => 0)) > 0) {
      return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("reCAPTCHA anchor iframe never appeared");
}

// ReCAPTCHA animates the checkbox, so its inner border div can be sitting on
// top of the hit point when Playwright tries to click. Focusing and pressing
// Space routes through the widget's own keyboard handler instead, which is
// what a real click ends up doing anyway.
async function tickCheckbox(page, frame) {
  await frame.locator(CHECKBOX).focus({ timeout: 30000 });
  await page.keyboard.press("Space");
}

const startedAt = Date.now();
console.log(`extension : ${EXTENSION_DIR}`);
console.log(`target    : ${TARGET_URL}`);
console.log(`timeout   : ${TIMEOUT_MS}ms`);

let context;
let solved = false;

try {
  if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: "chromium",
    args,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  console.log(`chromium  : ${context.browser()?.version()}`);

  // launchPersistentContext opens one page up front; reuse it rather than
  // adding a tab, since each tab is a live renderer holding memory.
  const page = context.pages()[0] ?? (await context.newPage());

  // Prove the extension's service worker actually started. Without this a
  // "solved" result could not be attributed to the extension.
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const extTargets = targetInfos.filter((t) =>
    t.url.startsWith("chrome-extension://"),
  );
  if (extTargets.length === 0) {
    console.error("FAIL: no chrome-extension:// target — extension did not load.");
    process.exit(2);
  }
  console.log(`ext target: ${extTargets[0].url}`);

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });

  // Clicking the checkbox is what makes Google issue the challenge the
  // extension exists to solve. It works through several rounds of tile
  // swapping, so expect 60-150s before the box ticks itself.
  const frame = await waitForAnchor(page, 30000);
  await tickCheckbox(page, frame);
  console.log("clicked  : reCAPTCHA checkbox");

  // The one and only assertion: does the checkbox end up checked? Poll rather
  // than waitFor so a screenshot can be dropped every SHOT_INTERVAL_MS along
  // the way — a CI failure is then diagnosable from the artifact alone.
  const deadline = Date.now() + TIMEOUT_MS;
  for (let elapsed = 0; Date.now() < deadline; elapsed += SHOT_INTERVAL_MS) {
    if (
      (await frame.locator(`${CHECKBOX}[aria-checked="true"]`).count()) > 0
    ) {
      solved = true;
      break;
    }
    if (SHOT_DIR) {
      const shot = join(
        SHOT_DIR,
        `t${String(Math.round(elapsed / 1000)).padStart(4, "0")}s.png`,
      );
      await page.screenshot({ path: shot }).catch(() => {});
    }
    await page.waitForTimeout(SHOT_INTERVAL_MS);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (solved) {
    console.log(`PASS: checkbox solved in ${elapsed}s`);
    console.log(`  shots    : ${SHOT_DIR ?? "(none)"}`);
    process.exitCode = 0;
  } else {
    console.error(`FAIL: checkbox not checked after ${elapsed}s`);
    console.error(
      `  aria-checked : ${await frame
        .locator(CHECKBOX)
        .getAttribute("aria-checked")
        .catch(() => "(gone)")}`,
    );
    console.error(`  shots       : ${SHOT_DIR ?? "(none)"}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("FAIL: test errored:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  // The profile dir carries its own Chromium caches; don't leave it behind.
  rmSync(PROFILE_DIR, { recursive: true, force: true });
}