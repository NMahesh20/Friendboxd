// ─── Browser fingerprint module ─────────────────────────────────────────
// A fingerprint is a coherent set of signals a real browser sends: the TLS
// impersonation target (curl-impersonate / curl-cffi `impersonate`), a
// User-Agent matching that target, Client Hints (sec-ch-ua*), and the
// standard page-load / API (fetch) header sets.
//
// Why this exists: Letterboxd fingerprints the TLS handshake and the
// coherence of headers (UA + language + encoding + Client Hints must all
// come from the same browser family). It expects two distinct header
// profiles: page-load headers for the initial warm-up GET (a real top-level
// navigation sends sec-fetch-site: none, document/navigate + cache hint)
// and same-origin navigation/API headers (Referer + sec-fetch-*) for the
// data calls that follow a visit.
//
// All headers derived from one Fingerprint share a single UA + hint set, so
// a primed session cookie is always replayed under the same identity —
// rotating UA/hints mid-session is itself a bot signal, so the crawler
// keeps one session-stable fingerprint (see sessionFingerprint()).

interface TargetProfile {
  userAgent: string;
  platform: string;
  platformVersion: string;
  arch: string;
  bitness: string;
  /** sec-ch-ua brand string (coherent with the UA major version). */
  secChUa: string;
  /** sec-ch-ua-full-version-list (real build for that Chrome version). */
  secChUaFull: string;
}

// One coherent identity per impersonation target. Client Hints must match
// the chosen target — a WAF cross-checks the brand strings against the UA
// major version and the TLS profile.
const TARGET_PROFILES: Record<string, TargetProfile> = {
  chrome131: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Windows',
    platformVersion: '15.0.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaFull:
      '"Google Chrome";v="131.0.6778.86", "Chromium";v="131.0.6778.86", "Not_A Brand";v="24.0.0.0"',
  },
  chrome124: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'Windows',
    platformVersion: '15.0.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaFull:
      '"Chromium";v="124.0.6367.118", "Google Chrome";v="124.0.6367.118", "Not-A.Brand";v="99.0.0.0"',
  },
  chrome120: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Windows',
    platformVersion: '15.0.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    secChUaFull:
      '"Not_A Brand";v="8.0.0.0", "Chromium";v="120.0.6099.109", "Google Chrome";v="120.0.6099.109"',
  },
  chrome116: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    platform: 'Windows',
    platformVersion: '15.0.0',
    arch: 'x86',
    bitness: '64',
    secChUa: '"Not)A;Brand";v="99", "Google Chrome";v="116", "Chromium";v="116"',
    secChUaFull:
      '"Not)A;Brand";v="99.0.0.0", "Google Chrome";v="116.0.5845.96", "Chromium";v="116.0.5845.96"',
  },
};

// curl-impersonate impersonation targets. Prefer recent, maintained
// profiles — WAFs learn old TLS fingerprints over time.
export const DEFAULT_IMPERSONATE = 'chrome131';

// All known profiles. When no explicit target is configured, the crawler
// randomly samples these (up to 3 attempts, see impersonate.ts) so each
// crawl session presents a different, still-coherent browser identity —
// rotating per session looks organic; rotating per request looks like a bot.
export function knownProfiles(): string[] {
  return Object.keys(TARGET_PROFILES);
}

/** Randomly pick a known impersonation target (optionally excluding one). */
export function randomProfile(exclude?: string | null): string {
  const ids = knownProfiles().filter((t) => t !== exclude);
  return ids[Math.floor(Math.random() * ids.length)];
}

/** Fisher–Yates shuffle of the known profiles (optionally excluding one). */
export function shuffledProfiles(exclude?: string | null): string[] {
  const ids = knownProfiles().filter((t) => t !== exclude);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

const COMMON_HEADERS: Record<string, string> = {
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  Priority: 'u=0, i',
};

// Headers a browser sends when it first navigates to a page.
const PAGE_LOAD_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

// Headers a browser's same-origin fetch() sends when the page calls its own API.
const API_ACCEPT = 'application/json, text/plain, */*';

/**
 * Resolve the impersonation profile for a source (env-overridable).
 * Precedence: <SOURCE>_IMPERSONATE, CRAWLER_IMPERSONATE.
 * Returns null when no explicit target is configured or the configured one
 * isn't a known profile — callers then randomly sample known profiles
 * (session rotation) instead of being pinned to a single identity.
 */
export function getImpersonate(source: string): string | null {
  const value =
    process.env[`${source.toUpperCase()}_IMPERSONATE`] ??
    process.env.CRAWLER_IMPERSONATE;
  return value && TARGET_PROFILES[value] ? value : null;
}

export class Fingerprint {
  /** Resolved impersonation target (member of TARGET_PROFILES). */
  readonly impersonate: string;
  /** Stable per-session UA coherent with the impersonation target. */
  readonly userAgent: string;

  private readonly profile: TargetProfile;
  private readonly common: Record<string, string>;

  constructor(impersonate?: string | null, userAgent?: string | null) {
    // When the requested target isn't a known profile — including when none
    // is configured at all — randomly pick a known one rather than pinning
    // every session to the same identity. The pick happens once per process,
    // so the whole crawl session stays coherent under one UA + hint set.
    this.impersonate =
      impersonate && TARGET_PROFILES[impersonate] ? impersonate : randomProfile(impersonate);
    this.profile = TARGET_PROFILES[this.impersonate];
    this.userAgent = userAgent || this.profile.userAgent;
    this.common = { ...COMMON_HEADERS };
    // Client Hints must match the impersonation target (Letterboxd
    // cross-checks the brand strings against the UA + TLS profile).
    this.common['sec-ch-ua'] = this.profile.secChUa;
    this.common['sec-ch-ua-mobile'] = '?0';
    this.common['sec-ch-ua-platform'] = `"${this.profile.platform}"`;
    this.common['sec-ch-ua-platform-version'] = `"${this.profile.platformVersion}"`;
    this.common['sec-ch-ua-full-version-list'] = this.profile.secChUaFull;
    this.common['sec-ch-ua-arch'] = `"${this.profile.arch}"`;
    this.common['sec-ch-ua-bitness'] = `"${this.profile.bitness}"`;
    this.common['sec-ch-ua-model'] = '""';
    this.common['sec-ch-ua-wow64'] = '?0';
  }

  get commonHeaders(): Record<string, string> {
    return { ...this.common };
  }

  /** Headers for a top-level navigation (the initial warm-up GET). */
  pageLoadHeaders(): Record<string, string> {
    return {
      ...this.common,
      'User-Agent': this.userAgent,
      Accept: PAGE_LOAD_ACCEPT,
      // A typed/entered URL: document / navigate / none + user gesture.
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'Cache-Control': 'max-age=0',
    };
  }

  /** Headers for an in-site link click / pagination navigation. */
  navigationHeaders(referer: string): Record<string, string> {
    return {
      ...this.common,
      'User-Agent': this.userAgent,
      Accept: PAGE_LOAD_ACCEPT,
      // Following a link within the site: same-origin + Referer.
      Referer: referer,
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
    };
  }

  /** Headers for a same-origin API/fetch() call. */
  apiHeaders(referer?: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.common,
      'User-Agent': this.userAgent,
      Accept: API_ACCEPT,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };
    if (referer) headers.Referer = referer;
    return headers;
  }
}

// ─── Session fingerprint ─────────────────────────────────────────────────
// One identity per process (the whole crawl session), so cookies primed
// under one UA/hints set are always replayed coherently. Exposed so the
// HTTP and stealth-browser strategies share the same identity.
let session: Fingerprint | null = null;

export function sessionFingerprint(impersonate?: string | null): Fingerprint {
  if (!session || (impersonate && session.impersonate !== impersonate)) {
    session = new Fingerprint(impersonate);
  }
  return session;
}

/** Reset the session identity (e.g. after the impersonation target is
 * resolved for the first request, or in tests). */
export function resetSessionFingerprint(): void {
  session = null;
}