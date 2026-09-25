'use client';

import { useEffect, useState } from 'react';

const POLL_MS = 2000;

export interface LiveCrawlStatus {
  /** Whitelisted phase line (falls back to the given fallback text). */
  line: string;
  /** Username currently being crawled, if any. */
  user: string | null;
  /** Film title currently being processed, if any. */
  film: string | null;
}

/**
 * Poll GET /api/status while `active` and return the current crawl
 * one-liner (a safe, server-whitelisted string) plus who/what it's working
 * on. Falls back to `fallback` while the server hasn't reported a phase, or
 * once the crawl ends. Polling stops entirely when `active` is false, so an
 * idle page makes no requests.
 */
export function useCrawlStatus(active: boolean, fallback: string): LiveCrawlStatus {
  const [status, setStatus] = useState<LiveCrawlStatus>({
    line: fallback,
    user: null,
    film: null,
  });

  useEffect(() => {
    if (!active) {
      setStatus({ line: fallback, user: null, film: null });
      return;
    }
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          line?: string | null;
          user?: string | null;
          film?: string | null;
        };
        if (!alive) return;
        setStatus({
          line: typeof data.line === 'string' && data.line ? data.line : fallback,
          user: typeof data.user === 'string' && data.user ? data.user : null,
          film: typeof data.film === 'string' && data.film ? data.film : null,
        });
      } catch {
        // Keep the last status on transient failures.
      }
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active, fallback]);

  return status;
}