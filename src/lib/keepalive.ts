// ─── Crawl keep-alive ────────────────────────────────────────────────────
// Render's free tier spins the service down after ~15 minutes with no
// incoming requests. A long crawl (rate-limited friend watchlists + film
// enrichment) can keep the engine busy for many minutes, so while a crawl
// is in flight we ping our own /api/health every few minutes to keep the
// instance awake. When no crawl is running we stay completely silent, so
// the service can still sleep normally (and not accrue free-tier uptime
// needlessly).

const PING_INTERVAL_MS = 4 * 60 * 1000; // well under Render's 15-min idle

let activeCrawls = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** Note the start of a crawl; starts the self-ping loop for the first crawl. */
export function markCrawlStart(): void {
  activeCrawls++;
  if (activeCrawls === 1) startPinging();
}

/** Note the end of a crawl; stops the self-ping loop when the last one ends. */
export function markCrawlEnd(): void {
  activeCrawls = Math.max(0, activeCrawls - 1);
  if (activeCrawls === 0) stopPinging();
}

function startPinging(): void {
  if (pingTimer) return;
  // unref so the timer alone never keeps the process alive — during a crawl
  // the crawl itself does; between crawls we stop the timer anyway.
  pingTimer = setInterval(() => {
    void pingSelf();
  }, PING_INTERVAL_MS);
  pingTimer.unref?.();
}

function stopPinging(): void {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

/** One best-effort GET to our own health endpoint. Never throws to callers. */
async function pingSelf(): Promise<void> {
  // Render exposes its public URL; locally, fall back to the dev server.
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT ?? 3000}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    if (!res.ok) console.warn(`[keepalive] self-ping failed (${res.status})`);
  } catch (err) {
    // Best-effort only — a failed ping must never affect the crawl.
    console.warn(`[keepalive] self-ping error: ${err instanceof Error ? err.message : err}`);
  } finally {
    clearTimeout(timeout);
  }
}