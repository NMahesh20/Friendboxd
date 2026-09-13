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
}

export interface AiConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
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
  delayMs: int(process.env.CRAWLER_DELAY_MS, 500),
  timeoutMs: int(process.env.CRAWLER_TIMEOUT_MS, 20000),
  maxFilms: int(process.env.CRAWLER_MAX_FILMS, 200),
  maxFriends: int(process.env.CRAWLER_MAX_FRIENDS, 20),
  // The user's own watchlist is the exclusion set, so crawl it deeper
  // than friends' lists to avoid recommending already-watched films.
  maxUserPages: int(process.env.CRAWLER_MAX_USER_PAGES, 8),
  // Polite rate limit: 2 requests per 10s by default.
  rateMax: int(process.env.CRAWLER_RATE_MAX, 2),
  rateWindowMs: int(process.env.CRAWLER_RATE_WINDOW_MS, 10000),
  // Lazy-loaded posters: wait up to 4s for a real poster to appear in the
  // browser (adaptive — usually finishes well before the cap). Scroll steps
  // are 120ms apart so lazy images load as the page is walked through.
  posterWaitMs: int(process.env.CRAWLER_POSTER_WAIT_MS, 4000),
  browserScrollDelayMs: int(process.env.CRAWLER_BROWSER_SCROLL_DELAY_MS, 120),
};

export const aiConfig: AiConfig = {
  apiKey: process.env.OPENAI_API_KEY || null,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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