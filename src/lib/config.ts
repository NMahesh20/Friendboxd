// ─── Runtime configuration (server-side) ────────────────────────────────

export interface CrawlerConfig {
  mode: 'auto' | 'http' | 'browser';
  maxPages: number;
  delayMs: number;
  timeoutMs: number;
  maxFilms: number;
  maxFriends: number;
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

/**
 * True when running on Vercel (serverless). We use this to pick leaner
 * defaults: HTTP-only crawling (no Playwright browser), a smaller crawl
 * scope, and an ephemeral /tmp cache — all to fit the Hobby plan's 60s
 * function limit and read-only filesystem.
 */
const isVercel = process.env.VERCEL === '1';

export const crawlerConfig: CrawlerConfig = {
  mode:
    (process.env.CRAWLER_MODE as CrawlerConfig['mode']) ||
    (isVercel ? 'http' : 'auto'),
  maxPages: int(process.env.CRAWLER_MAX_PAGES, isVercel ? 2 : 3),
  delayMs: int(process.env.CRAWLER_DELAY_MS, isVercel ? 300 : 500),
  timeoutMs: int(process.env.CRAWLER_TIMEOUT_MS, isVercel ? 15000 : 20000),
  maxFilms: int(process.env.CRAWLER_MAX_FILMS, isVercel ? 120 : 200),
  maxFriends: int(process.env.CRAWLER_MAX_FRIENDS, isVercel ? 15 : 20),
};

export const aiConfig: AiConfig = {
  apiKey: process.env.OPENAI_API_KEY || null,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
};

export const cacheConfig: CacheConfig = {
  // On Vercel the filesystem is read-only except /tmp, which is shared
  // across warm invocations of the same instance — good enough for a 1h
  // crawl cache. Locally we cache in the repo (.cache, gitignored).
  dir: process.env.CACHE_DIR || (isVercel ? '/tmp/friendboxd-cache' : '.cache'),
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