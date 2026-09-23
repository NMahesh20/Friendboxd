// ─── HTTP fetch strategy with browser fingerprints + throttling + retry ──
// Uses a coherent per-session browser fingerprint (stable UA + Client Hints
// matched to one TLS impersonation target, see fingerprint.ts) and polite
// throttling to reduce the chance of being blocked.
//
// Transport order:
//   1. curl-impersonate when available — the same engine the Python
//      `curl_cffi` module wraps. It sends a real Chrome TLS ClientHello /
//      HTTP2 fingerprint (Node's OpenSSL TLS is trivially distinguishable).
//   2. undici fetch (Next.js-patched or proxied) as a dependency-free
//      fallback when the binary isn't installed.
//
// Visiting pattern (mirrors a real browser session):
//   - First request to an origin is a TOP-LEVEL navigation: page-load
//     headers, sec-fetch-site: none, Cache-Control: max-age=0. This primes
//     the session cookie, which is replayed on every later request (the
//     impersonation transport keeps a per-process cookie jar).
//   - Every subsequent request is an IN-SITE navigation: same-origin
//     sec-fetch-* with the previous page as Referer.
//   Letterboxd gates profile paths against cold `site:none` hits, so this
//   warm-up + referer flow is what gets the crawl through (verified live).
//
// Proxy support: set PROXY_POOL to a comma-separated list of proxies, e.g.
//   PROXY_POOL="http://user:pass@host:8080,http://host2:8080"
// When multiple proxies are configured, each retry attempt rotates to a
// different one (up to PROXY_MAX_TRIES, default 3).

import { crawlerConfig, proxyConfig } from '@/lib/config';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { Fingerprint, getImpersonate, sessionFingerprint } from './fingerprint';
import { fetchImpersonated, ImpersonateTransportError, resolveTransport } from './impersonate';
import { rateLimiter } from './rate-limiter';

// ─── Session fingerprint ────────────────────────────────────────────────
// One identity for the whole crawl session. Rotating UA/hints per request —
// as the old code did — is itself a bot signal: a real browser keeps one
// identity for the session, and primed cookies must be replayed under it.
// The identity is locked to the impersonation target the local
// curl-impersonate binary actually supports, so UA + Client Hints + TLS
// profile always stay coherent.
let session: Fingerprint | null = null;

async function ensureSession(): Promise<Fingerprint> {
  if (!session) {
    const transport = await resolveTransport();
    session = sessionFingerprint(transport ? transport.target : getImpersonate('letterboxd'));
  }
  return session;
}

// Origins primed with a top-level warm-up GET this session.
const warmedOrigins = new Set<string>();

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
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

// Reuse ProxyAgent instances so each proxy keeps its own connection pool.
const proxyAgents = new Map<string, ProxyAgent>();

function getProxyAgent(proxyUrl: string): ProxyAgent {
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }
  return agent;
}

/**
 * Fetch through an optional proxy. Without a proxy we use the global fetch
 * (Next.js-patched); with one we use undici's fetch + ProxyAgent so the
 * request actually egresses through the proxy.
 */
async function doFetch(
  url: string,
  init: RequestInit,
  proxyUrl?: string,
): Promise<Response> {
  if (!proxyUrl) return fetch(url, init);
  const agent = getProxyAgent(proxyUrl);
  const res = await undiciFetch(url, {
    ...init,
    dispatcher: agent,
  } as Parameters<typeof undiciFetch>[1]);
  return res as unknown as Response;
}

/**
 * Detect challenge / bot pages. Be specific: Cloudflare injects a
 * `/cdn-cgi/challenge-platform/...` script on ALL pages (even real ones), so
 * match only markers that appear on actual challenge pages (the challenge
 * form / error details), or the challenge <title>.
 */
function isChallengePage(html: string): boolean {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) ?? [])[1] ?? '';
  return (
    html.length < 500 ||
    /just a moment|attention required/i.test(title) ||
    /cf-challenge-form|challenge-form|cf-error-details|challenge-running|turnstile-container|cf-turnstile-form|challenge-stage|cf_chl_opt|challenge-content/i.test(
      html,
    )
  );
}

/** Normalize an HTTP response into HttpResult or throw HttpFetchError. */
function toResult(html: string, status: number, finalUrl: string): HttpResult {
  if (status === 403 || status === 429) {
    throw new HttpFetchError(`Blocked by Letterboxd (HTTP ${status})`, status, true);
  }
  if (status === 404) {
    throw new HttpFetchError('Not found (HTTP 404)', 404, false);
  }
  if (status < 200 || status >= 300) {
    throw new HttpFetchError(`Unexpected status ${status}`, status, true);
  }
  if (isChallengePage(html)) {
    throw new HttpFetchError('Challenge page detected', 403, true);
  }
  return { html, status, finalUrl };
}

/**
 * Single HTTP request via the best available transport. Tries the
 * TLS-impersonating curl-impersonate binary first, then falls back to
 * undici if the binary is missing or the request dies on the transport.
 */
async function requestOnce(
  url: string,
  headers: Record<string, string>,
  proxy: string | undefined,
  timeoutMs: number,
): Promise<HttpResult> {
  const transport = await resolveTransport();
  if (transport) {
    try {
      const res = await fetchImpersonated(url, headers, { proxy, timeoutMs });
      return toResult(res.html, res.status, res.finalUrl);
    } catch (err) {
      if (err instanceof ImpersonateTransportError) {
        console.warn('[crawler] impersonated fetch failed, undici fallback:', (err as Error).message);
      } else {
        throw err;
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(
      url,
      {
        signal: controller.signal,
        redirect: 'follow',
        // Next.js patches global fetch with its own cache; bypass it so we
        // always hit Letterboxd fresh (and never get a stale 403).
        cache: 'no-store',
        headers,
      },
      proxy,
    );
    const html = await res.text();
    return toResult(html, res.status, res.url);
  } catch (err) {
    if (err instanceof HttpFetchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpFetchError('Request timed out', 0, true);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL with throttling, retries, a coherent browser fingerprint and
 * optional proxy rotation + TLS impersonation. Throws HttpFetchError on
 * failure.
 */
export async function fetchHtml(url: string, opts: { referer?: string } = {}): Promise<HttpResult> {
  const { timeoutMs, delayMs } = crawlerConfig;
  const proxies = proxyConfig.pool;
  const maxAttempts = 3;
  const origin = originOf(url);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Polite throttle between attempts.
    if (attempt > 1) await sleep(delayMs * attempt);

    // Rotate through the proxy pool on each attempt (p1, p2, p3, p1…).
    const proxy = proxies.length > 0 ? proxies[(attempt - 1) % proxies.length] : undefined;

    try {
      const fp = await ensureSession();

      // 1. Prime the origin with a top-level navigation (page-load headers,
      //    sec-fetch-site: none) on this session's first visit, so the
      //    "primed" session cookie exists when the real request follows.
      const homeUrl = `${origin}/`;
      if (!warmedOrigins.has(origin) && url !== homeUrl) {
        await rateLimiter.acquire();
        await requestOnce(homeUrl, fp.pageLoadHeaders(), proxy, timeoutMs);
        warmedOrigins.add(origin);
      }

      // 2. The real request: an in-site navigation (same-origin + Referer)
      //    when a referer is given, else a top-level page load.
      await rateLimiter.acquire();
      const headers = opts.referer ? fp.navigationHeaders(opts.referer) : fp.pageLoadHeaders();
      return await requestOnce(url, headers, proxy, timeoutMs);
    } catch (err) {
      lastError = err;
      if (err instanceof HttpFetchError && !err.retriable) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new HttpFetchError('Request timed out', 0, true);
      }
      if (proxy) {
        console.warn(
          `[crawler] attempt ${attempt}/${maxAttempts} via proxy ${proxy} failed:`,
          (err as Error).message,
        );
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new HttpFetchError('Request failed', 0, true);
}