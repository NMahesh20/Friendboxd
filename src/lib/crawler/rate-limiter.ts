// ─── Sliding-window rate limiter ────────────────────────────────────────
// Keeps the crawler polite to Letterboxd: at most `rateMax` requests per
// `rateWindowMs` (default 8 per 10s). Every Letterboxd request funnels
// through this singleton before it is sent, regardless of whether the
// HTTP or stealth-browser strategy is used.
//
// Tune via env vars:
//   CRAWLER_RATE_MAX        (default 8)
//   CRAWLER_RATE_WINDOW_MS  (default 10000)

import { crawlerConfig } from '@/lib/config';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SlidingWindowLimiter {
  private timestamps: number[] = [];
  // Serializes concurrent acquisitions so callers queue up instead of
  // racing through the window check.
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Wait until a slot is free, then record the call. Resolves once the
   * request is allowed to proceed.
   */
  async acquire(): Promise<void> {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = gate;
    await prev;
    try {
      const now = Date.now();
      // Keep only calls still inside the window.
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length >= this.max) {
        // Wait until the oldest call falls out of the window.
        const waitMs = this.timestamps[0] + this.windowMs - now;
        if (waitMs > 0) {
          console.debug(`[crawler] rate limit: waiting ${Math.ceil(waitMs)}ms`);
          await sleep(waitMs);
        }
        // Re-filter after the wait — the oldest call has now expired.
        const after = Date.now();
        this.timestamps = this.timestamps.filter((t) => after - t < this.windowMs);
      }

      this.timestamps.push(Date.now());
    } finally {
      release();
    }
  }
}

/** Shared limiter used by every crawler request. */
export const rateLimiter = new SlidingWindowLimiter(
  crawlerConfig.rateMax,
  crawlerConfig.rateWindowMs,
);