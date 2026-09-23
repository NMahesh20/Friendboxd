// ─── Optional TLS-impersonating transport (curl-impersonate) ────────────
// Node's built-in TLS (OpenSSL ClientHello) is distinctive and detectable by
// fingerprinting WAFs even when the HTTP headers are perfect — the original
// fingerprint module's whole point was TLS impersonation via curl-cffi.
// `curl-impersonate` is the exact engine curl-cffi wraps: a patched curl
// whose TLS ClientHello / HTTP2 settings / header order are byte-compatible
// with real Chrome, Edge, Safari and Firefox builds.
//
// This module shells out to a curl-impersonate binary when one is present
// (searched on PATH; override the location with CURL_IMPERSONATE_BIN) and
// the crawler shrinks back to undici fetch when it isn't, so the app always
// boots and crawls — just without the TLS impersonation layer.
//
// Env:
//   CRAWLER_TLS_IMPERSONATION  auto|off   (default auto; "off" forces undici)
//   CRAWLER_IMPERSONATE        chrome131  (optional; pins the fingerprint —
//                                          when unset, a known profile is
//                                          picked at random per session)
//   CURL_IMPERSONATE_BIN       /path/to/curl-impersonate (override search)
// Install: grab a prebuilt release from
//   https://github.com/lexiforest/curl-impersonate/releases
// and drop `curl-impersonate` / `curl_chrome131` on PATH.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getImpersonate, knownProfiles, shuffledProfiles } from './fingerprint';

const execFileAsync = promisify(execFile);

// Binary names searched on PATH (in order of preference). Per-version
// binaries like curl_chrome131 imply their own impersonation target.
const BINARY_NAMES = [
  'curl-impersonate', // generic chrome/edge/safari build (lexiforest v2.x)
  'curl-impersonate-chrome',
  'curl_chrome131',
  'curl_chrome124',
  'curl_chrome120',
  'curl_chrome116',
];

/** Marker written by curl's --write-out, parsed out of stdout. */
const STATUS_MARKER = '__FRIENDBOXD_HTTP__';
const URL_MARKER = '__FRIENDBOXD_URL__';

export class ImpersonateTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImpersonateTransportError';
  }
}

export interface ImpersonatedResult {
  html: string;
  status: number;
  finalUrl: string;
}

let lastStatus = 0; // last HTTP status seen, used if marker parsing fails

interface ResolvedTransport {
  binary: string;
  target: string;
  cookieJar: string;
}

let transportPromise: Promise<ResolvedTransport | null> | null = null;
let disabled = process.env.CRAWLER_TLS_IMPERSONATION === 'off';

/** True when the optional impersonation layer may be used at all. */
export function isTlsImpersonationEnabled(): boolean {
  return !disabled;
}

/** Force the transport off (e.g. for tests / hosts without the binary). */
export function setTlsImpersonationEnabled(enabled: boolean): void {
  disabled = !enabled;
  transportPromise = null;
}

function targetFromBinaryName(name: string): string | null {
  // curl_chrome131 -> chrome131
  const m = name.match(/curl_chrome(\d+)$/);
  return m ? `chrome${m[1]}` : null;
}

/**
 * Probe whether `binary` accepts the given --impersonate target. We hit a
 * local address on port 1: if the target parses, curl fails with a
 * connection error (exit 7); an unknown target fails earlier with a
 * "Unknown impersonation target" error (exit 43). Fully local, no network.
 */
async function probeTarget(binary: string, target: string): Promise<boolean> {
  try {
    await execFileAsync(
      binary,
      ['--impersonate', target, '--max-time', '2', 'https://127.0.0.1:1/'],
      { timeout: 5000, maxBuffer: 4096, encoding: 'utf8' },
    );
    return true;
  } catch (err) {
    const stderr = String((err as { stderr?: unknown })?.stderr ?? '');
    return !/unknown impersonation target/i.test(stderr);
  }
}

async function findBinary(candidates: string[]): Promise<string | null> {
  for (const name of candidates) {
    try {
      await execFileAsync(name, ['--version'], { timeout: 5000, maxBuffer: 8192 });
      return name;
    } catch {
      // ENOENT or not executable — try the next name.
    }
  }
  return null;
}

/** Resolve the curl-impersonate binary + a coherent impersonation target
 * it supports. Cached; returns null when unavailable or disabled. */
export function resolveTransport(): Promise<ResolvedTransport | null> {
  if (disabled) return Promise.resolve(null);
  if (!transportPromise) {
    transportPromise = (async () => {
      const explicit = process.env.CURL_IMPERSONATE_BIN?.trim();
      const candidates = explicit
        ? [explicit, ...BINARY_NAMES]
        : BINARY_NAMES;
      const binary = await findBinary(candidates);
      if (!binary) {
        console.warn(
          '[crawler] curl-impersonate not found — using undici transport (no TLS impersonation).',
        );
        return null;
      }

      // Prefer an explicitly configured target; otherwise randomly sample up
      // to 3 known profiles so each session rotates its browser identity
      // (UA + Client Hints stay coherent with whatever TLS profile wins).
      const wanted = getImpersonate('letterboxd');
      const pool = shuffledProfiles(wanted);
      const chain = wanted ? [wanted, ...pool] : pool;
      const tries = Math.min(3, chain.length);

      let target: string | null = null;
      const named = targetFromBinaryName(path.basename(binary));
      if (named) {
        // curl_chromeNNN binaries only speak one target; use it if we have
        // a coherent header profile for it.
        if (knownProfiles().includes(named)) {
          target = named;
        } else {
          console.warn(`[crawler] no header profile for ${named}; treating binary as generic.`);
        }
      }
      // Try up to 3 different (randomly drawn) profiles against the binary.
      if (!target) {
        for (const t of chain.slice(0, tries)) {
          if (await probeTarget(binary, t)) {
            target = t;
            break;
          }
        }
      }
      // Safety sweep: don't declare the binary unusable just because the 3
      // random samples happened to miss the one target it supports.
      if (!target) {
        for (const t of chain.slice(tries)) {
          if (await probeTarget(binary, t)) {
            target = t;
            break;
          }
        }
      }
      if (!target) {
        console.warn('[crawler] no supported impersonation target found — using undici transport.');
        return null;
      }

      const cookieJar = path.join(os.tmpdir(), `friendboxd-cookies-${process.pid}.jar`);
      await fs.writeFile(cookieJar, '', { flag: 'a' }).catch(() => {});
      console.info(`[crawler] TLS impersonation via ${binary} (--impersonate ${target})`);
      return { binary, target, cookieJar };
    })();
  }
  return transportPromise;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a URL through the curl-impersonate binary under a given fingerprint
 * and explicit header set. Throws ImpersonateTransportError on transport
 * failure (retriable); HTTP-level errors return normally with `status`.
 */
export async function fetchImpersonated(
  url: string,
  headers: Record<string, string>,
  opts: { proxy?: string; timeoutMs?: number } = {},
): Promise<ImpersonatedResult> {
  const transport = await resolveTransport();
  if (!transport) throw new ImpersonateTransportError('curl-impersonate unavailable');

  const timeoutMs = opts.timeoutMs ?? 20000;
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--compressed',
    '--impersonate',
    transport.target,
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    '-b',
    transport.cookieJar,
    '-c',
    transport.cookieJar,
  ];
  if (opts.proxy) args.push('--proxy', opts.proxy);
  for (const [name, value] of Object.entries(headers)) {
    args.push('-H', `${name}: ${value}`);
  }
  args.push('--write-out', `\n${STATUS_MARKER}%{http_code}${URL_MARKER}%{url_effective}`);
  args.push(url);

  let stdout = '';
  try {
    const res = await execFileAsync(transport.binary, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    });
    stdout = res.stdout;
  } catch (err) {
    if ((err as { killed?: boolean }).killed) {
      throw new ImpersonateTransportError('Request timed out');
    }
    const stderr = String((err as { stderr?: unknown })?.stderr ?? '');
    // Exit 22+ with --show-error but without --fail is a network/CONN error.
    throw new ImpersonateTransportError(stderr.trim() || String(err));
  }

  // Split body from the --write-out trailer.
  const markerIdx = stdout.lastIndexOf(`\n${STATUS_MARKER}`);
  let html = stdout;
  let status = lastStatus;
  let finalUrl = url;
  if (markerIdx !== -1) {
    html = stdout.slice(0, markerIdx);
    const meta = stdout.slice(markerIdx + 1);
    const statusMatch = meta.match(new RegExp(`${STATUS_MARKER}(\\d+)${URL_MARKER}(.*)$`));
    if (statusMatch) {
      status = parseInt(statusMatch[1], 10);
      finalUrl = statusMatch[2] || url;
    }
  }
  lastStatus = status;
  // Small human-like pause between requests keeps the session polite.
  await sleep(120);
  return { html, status, finalUrl };
}