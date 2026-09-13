// ─── Server-side session cache (file-based) ─────────────────────────────
// Stores crawl results keyed by username with a configurable TTL so we
// don't re-crawl within the same session. Implements a simple interface
// that can be swapped for Redis / Postgres in production.
//
// Expiry: entries older than `cacheConfig.ttlMs` are never served and are
// actively removed — expired in-memory entries are dropped on read, and a
// `clearExpired()` sweep (run on every write) prunes stale files from disk
// so the cache stays bounded without needing a background job.

import fs from 'node:fs';
import path from 'node:path';
import { cacheConfig } from '@/lib/config';
import type { Friend, TasteMatch } from '@/lib/types';

interface CacheEntry {
  user: Friend;
  friends: Friend[];
  matches: TasteMatch[];
  savedAt: number;
}

export type { CacheEntry };

const memCache = new Map<string, CacheEntry>();

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cacheFilePath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(cacheConfig.dir, `${safe}.json`);
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return now - entry.savedAt >= cacheConfig.ttlMs;
}

export function getCached(username: string): CacheEntry | null {
  const key = username.toLowerCase();
  const now = Date.now();

  // Check in-memory first.
  const mem = memCache.get(key);
  if (mem) {
    if (!isExpired(mem, now)) return mem;
    // Expired — drop it from memory so it can't linger.
    memCache.delete(key);
  }

  // Check file.
  try {
    const filePath = cacheFilePath(key);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CacheEntry;
      if (!isExpired(data, now)) {
        memCache.set(key, data);
        return data;
      }
      // Expired — remove from disk.
      fs.unlinkSync(filePath);
    }
  } catch {
    // Corrupted file — ignore.
  }
  return null;
}

export function setCached(
  username: string,
  data: { user: Friend; friends: Friend[]; matches: TasteMatch[] },
): void {
  // Opportunistic sweep: clear anything already past its TTL so the cache
  // stays bounded (there's no background job on serverless).
  clearExpired();

  const key = username.toLowerCase();
  const entry: CacheEntry = { ...data, savedAt: Date.now() };
  memCache.set(key, entry);

  try {
    ensureDir(cacheConfig.dir);
    fs.writeFileSync(cacheFilePath(key), JSON.stringify(entry), 'utf-8');
  } catch (err) {
    console.warn('[cache] write failed:', (err as Error).message);
  }
}

/**
 * Remove every expired entry — both in-memory and on disk. Cheap enough to
 * run on each write; keeps the cache directory from accumulating stale
 * files for users who never come back.
 */
export function clearExpired(): void {
  const now = Date.now();

  // Prune expired in-memory entries.
  for (const [key, entry] of memCache) {
    if (isExpired(entry, now)) memCache.delete(key);
  }

  // Prune expired files on disk.
  try {
    const dir = cacheConfig.dir;
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(dir, f);
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as CacheEntry;
        if (isExpired(data, now)) fs.unlinkSync(fp);
      } catch {
        // Corrupted/unreadable — remove it too.
        try {
          fs.unlinkSync(fp);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

export function clearCache(username?: string): void {
  if (username) {
    const key = username.toLowerCase();
    memCache.delete(key);
    try {
      const fp = cacheFilePath(key);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  } else {
    memCache.clear();
    try {
      const dir = cacheConfig.dir;
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
        }
      }
    } catch {
      // ignore
    }
  }
}