// ─── Runtime configuration (server-side) ────────────────────────────────

export interface CrawlerConfig {
  mode: 'auto' | 'http' | 'browser';
  maxPages: number;
  delayMs: number;
  timeoutMs: number;
  maxFilms: number;
  maxFriends: number;
  /** Max pages crawled for the user's OWN watchlist (exclusion set). */
  maxUserPages: number;
  /** Max requests allowed per sliding window (rate limiter). */
  rateMax: number;
  /** Sliding window length in ms (rate limiter). */
  rateWindowMs: number;
  /**
   * Max time (ms) the browser strategy waits for lazy-loaded posters to
   * appear. Letterboxd ships an empty placeholder in the initial HTML and
   * only swaps in the real poster after JS runs, so the browser must wait.
   * The wait is adaptive (stops as soon as a real poster loads) and capped
   * here so low-RAM hosts like Render aren't pinned for too long.
   */
  posterWaitMs: number;
  /** Delay (ms) between scroll steps when triggering lazy loading. */
  browserScrollDelayMs: number;
  /**
   * How long (ms) the background stealth browser may sit idle before it's
   * closed to free memory. A warm Chromium holds ~200-400MB — on small hosts
   * (Render free ≈ 512MB) that's most of the service budget, so a finished
   * crawl should not keep it resident forever. The next fetch relaunches it.
   */
  browserIdleTimeoutMs: number;
  /**
   * Block image/font/media downloads in the stealth browser. Letterboxd's
   * lazy-poster JS sets the real poster URL into the DOM regardless of
   * whether the download succeeds, and the crawler only reads the DOM src —
   * so blocking saves ~140MB of decoded-image memory per crawl (measured)
   * without hurting results. Disable with CRAWLER_BLOCK_ASSETS=0.
   */
  blockAssets: boolean;
}

export interface AiConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  /**
   * Max "AI suggested" film pages fetched to resolve real posters + ratings
   * (rate-limited, so it stays polite — bounds the added wall-clock time).
   */
  maxSuggestedFilms: number;
}

export interface CacheConfig {
  dir: string;
  ttlMs: number;
}

export interface ProxyConfig {
  /** Comma-separated proxy URLs, e.g. "http://user:pass@host:8080,http://host2:8080". */
  pool: string[];
  /** Max different proxies to try per request when the pool has multiple. */
  maxTries: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const crawlerConfig: CrawlerConfig = {
  mode: (process.env.CRAWLER_MODE as CrawlerConfig['mode']) || 'auto',
  maxPages: int(process.env.CRAWLER_MAX_PAGES, 3),
  // Small inter-page gap; the global rate limiter is the real throttle.
  delayMs: int(process.env.CRAWLER_DELAY_MS, 200),
  timeoutMs: int(process.env.CRAWLER_TIMEOUT_MS, 20000),
  maxFilms: int(process.env.CRAWLER_MAX_FILMS, 200),
  maxFriends: int(process.env.CRAWLER_MAX_FRIENDS, 20),
  // The user's own watchlist is the exclusion set, so crawl it deeper
  // than friends' lists to avoid recommending already-watched films.
  // (5 pages ≈ 150 films — keeps the analyze call inside Render's ~60s
  // request budget instead of eating a third of it on the exclusion set.)
  maxUserPages: int(process.env.CRAWLER_MAX_USER_PAGES, 5),
  // Polite rate limit default — the previous, known-good value. Letterboxd
  // sits behind Cloudflare, which starts throwing "Just a moment" challenges
  // at bursts of rapid requests; 8 per 10s (≈ one every 1.25s) stays under
  // the burst threshold while keeping crawls responsive and inside a
  // serverless request budget. Cut to 4 with CRAWLER_RATE_MAX if you see
  // burst 403s (a low limit just adds waits — it doesn't change identities).
  rateMax: int(process.env.CRAWLER_RATE_MAX, 5),
  rateWindowMs: int(process.env.CRAWLER_RATE_WINDOW_MS, 10000),
  // Lazy-loaded posters: wait up to 4s for a real poster to appear in the
  // browser (adaptive — usually finishes well before the cap). Scroll steps
  // are 120ms apart so lazy images load as the page is walked through.
  posterWaitMs: int(process.env.CRAWLER_POSTER_WAIT_MS, 4000),
  browserScrollDelayMs: int(process.env.CRAWLER_BROWSER_SCROLL_DELAY_MS, 120),
  // 5 min of no crawl traffic → close the background Chromium to free memory
  // on small hosts (next fetch relaunches). Override with
  // CRAWLER_BROWSER_IDLE_MS (0 disables the idle close).
  browserIdleTimeoutMs: int(process.env.CRAWLER_BROWSER_IDLE_MS, 5 * 60 * 1000),
  // Block image/font/media downloads in the browser context — the poster src
  // is set by JS regardless, so this mainly saves memory (see interface).
  blockAssets: (process.env.CRAWLER_BLOCK_ASSETS ?? '1') !== '0',
};

export const aiConfig: AiConfig = {
  // Gemini (Google AI) is the default AI provider. OPENAI_API_KEY is kept
  // as a fallback so existing deployments keep working during migration —
  // GEMINI_API_KEY wins when both are set.
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || null,
  baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
  model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  maxSuggestedFilms: int(process.env.AI_MAX_SUGGESTED, 8),
};

export const cacheConfig: CacheConfig = {
  // Cache lives in the repo (.cache, gitignored) locally, or wherever
  // CACHE_DIR points (e.g. /tmp in containers). Ephemeral by design — it's
  // a 1h crawl cache, not durable data.
  dir: process.env.CACHE_DIR || '.cache',
  ttlMs: int(process.env.CACHE_TTL_MS, 60 * 60 * 1000),
};

export const proxyConfig: ProxyConfig = {
  pool: (process.env.PROXY_POOL ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  maxTries: int(process.env.PROXY_MAX_TRIES, 3),
};

/** Maximum number of friends a user may select. */
export const MAX_SELECTED_FRIENDS = 5;

/** Number of candidate movies sent to the AI layer. */
export const CANDIDATE_POOL_SIZE = 30;

/** Number of recommendations returned to the user. */
export const RECOMMENDATION_COUNT = 12;