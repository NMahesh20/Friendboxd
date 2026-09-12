// ─── HTTP fetch strategy with throttling + retry ────────────────────────
// Uses realistic browser fingerprints and polite throttling to reduce the
// chance of being blocked. Falls back to the stealth browser strategy
// when the server responds with 403/429 or a challenge page.
//
// Proxy support: set PROXY_POOL to a comma-separated list of proxies, e.g.
//   PROXY_POOL="http://user:pass@host:8080,http://host2:8080"
// When multiple proxies are configured, each retry attempt rotates to a
// different one (up to PROXY_MAX_TRIES, default 3).

import { crawlerConfig, proxyConfig } from '@/lib/config';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

// ─── Browser fingerprints ───────────────────────────────────────────────
// Each entry pairs a realistic User-Agent with the matching client-hint
// (sec-ch-ua*) headers a real browser of that UA would send. Firefox and
// Safari don't send sec-ch-ua, so those entries leave it empty.

interface Fingerprint {
  userAgent: string;
  platform: string;
  platformVersion: string;
  arch: string;
  bitness: string;
  secChUa: string;
  secChUaFull: string;
}

const FINGERPRINTS: Fingerprint[] = [
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    platform: 'Windows',
    platformVersion: '15.0.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Not)A;Brand";v="99", "Google Chrome";v="128", "Chromium";v="128"',
    secChUaFull:
      '"Not)A;Brand";v="99.0.0.0", "Google Chrome";v="128.0.6613.84", "Chromium";v="128.0.6613.84"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    platform: 'macOS',
    platformVersion: '14.5.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
    secChUaFull:
      '"Not)A;Brand";v="99.0.0.0", "Google Chrome";v="127.0.6533.99", "Chromium";v="127.0.6533.99"',
  },
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    platform: 'Linux',
    platformVersion: '6.5.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    secChUaFull:
      '"Not/A)Brand";v="8.0.0.0", "Chromium";v="126.0.6478.127", "Google Chrome";v="126.0.6478.127"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    platform: 'Windows',
    platformVersion: '15.0.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Not)A;Brand";v="99", "Microsoft Edge";v="128", "Chromium";v="128"',
    secChUaFull:
      '"Not)A;Brand";v="99.0.0.0", "Microsoft Edge";v="128.0.2739.42", "Chromium";v="128.0.6613.84"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
    platform: 'Windows',
    platformVersion: '15.0.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '',
    secChUaFull: '',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    platform: 'macOS',
    platformVersion: '14.5.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '',
    secChUaFull: '',
  },
];

const ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',
  'en-GB,en;q=0.9',
  'en-US,en;q=0.9,es;q=0.8',
  'en-CA,en;q=0.9,fr;q=0.8',
];

function pickFingerprint(): Fingerprint {
  return FINGERPRINTS[Math.floor(Math.random() * FINGERPRINTS.length)];
}

function pickAcceptLanguage(): string {
  return ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)];
}

function buildHeaders(referer?: string): Record<string, string> {
  const fp = pickFingerprint();
  const headers: Record<string, string> = {
    'User-Agent': fp.userAgent,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': pickAcceptLanguage(),
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: referer ?? 'https://letterboxd.com/',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    Connection: 'keep-alive',
    Priority: 'u=0, i',
  };
  // Chromium-based fingerprints also send client hints.
  if (fp.secChUa) {
    headers['sec-ch-ua'] = fp.secChUa;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = `"${fp.platform}"`;
    headers['sec-ch-ua-platform-version'] = `"${fp.platformVersion}"`;
    headers['sec-ch-ua-full-version-list'] = fp.secChUaFull;
    headers['sec-ch-ua-arch'] = `"${fp.arch}"`;
    headers['sec-ch-ua-bitness'] = `"${fp.bitness}"`;
    headers['sec-ch-ua-model'] = '""';
  }
  return headers;
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
 * Fetch a URL with throttling, retries, realistic fingerprints and optional
 * proxy rotation. Throws HttpFetchError on failure.
 */
export async function fetchHtml(url: string, opts: { referer?: string } = {}): Promise<HttpResult> {
  const { timeoutMs, delayMs } = crawlerConfig;
  const proxies = proxyConfig.pool;
  const maxAttempts = 3;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Polite throttle between attempts.
    if (attempt > 1) await sleep(delayMs * attempt);

    // Rotate through the proxy pool on each attempt (p1, p2, p3, p1…).
    const proxy = proxies.length > 0 ? proxies[(attempt - 1) % proxies.length] : undefined;

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
          headers: buildHeaders(opts.referer),
        },
        proxy,
      );

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
      if (proxy) {
        console.warn(
          `[crawler] attempt ${attempt}/${maxAttempts} via proxy ${proxy} failed:`,
          (err as Error).message,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new HttpFetchError('Request failed', 0, true);
}