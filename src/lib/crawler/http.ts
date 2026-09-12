// ─── HTTP fetch strategy with throttling + retry ────────────────────────
// Uses realistic browser headers and polite throttling to reduce the
// chance of being blocked. Falls back to the stealth browser strategy
// when the server responds with 403/429 or a challenge page.

import { crawlerConfig } from '@/lib/config';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export interface HttpResult {
  html: string;
  status: number;
  finalUrl: string;
}

export class HttpFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retriable: boolean,
  ) {
    super(message);
    this.name = 'HttpFetchError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a URL with throttling, retries and realistic headers.
 * Throws HttpFetchError on failure.
 */
export async function fetchHtml(url: string, opts: { referer?: string } = {}): Promise<HttpResult> {
  const { timeoutMs, delayMs } = crawlerConfig;
  const maxAttempts = 3;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Polite throttle between attempts.
    if (attempt > 1) await sleep(delayMs * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        // Next.js patches global fetch with its own cache; bypass it so we
        // always hit Letterboxd fresh (and never get a stale 403).
        cache: 'no-store',
        headers: {
          'User-Agent': pickUserAgent(),
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: opts.referer ?? 'https://letterboxd.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
        },
      });

      if (res.status === 403 || res.status === 429) {
        throw new HttpFetchError(`Blocked by Letterboxd (HTTP ${res.status})`, res.status, true);
      }
      if (res.status === 404) {
        throw new HttpFetchError('Not found (HTTP 404)', 404, false);
      }
      if (!res.ok) {
        throw new HttpFetchError(`Unexpected status ${res.status}`, res.status, true);
      }

      const html = await res.text();
      // Detect challenge / bot pages. Be specific: Cloudflare injects a
      // `/cdn-cgi/challenge-platform/...` script on ALL pages (even real
      // ones), so match only markers that appear on actual challenge pages
      // (the challenge form / error details), or the challenge <title>.
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) ?? [])[1] ?? '';
      const isChallenge =
        html.length < 500 ||
        /just a moment|attention required/i.test(title) ||
        /cf-challenge-form|challenge-form|cf-error-details|challenge-running|turnstile-container|cf-turnstile-form|challenge-stage|cf_chl_opt|challenge-content/i.test(
          html,
        );
      if (isChallenge) {
        throw new HttpFetchError('Challenge page detected', 403, true);
      }
      return { html, status: res.status, finalUrl: res.url };
    } catch (err) {
      lastError = err;
      if (err instanceof HttpFetchError && !err.retriable) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new HttpFetchError('Request timed out', 0, true);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new HttpFetchError('Request failed', 0, true);
}