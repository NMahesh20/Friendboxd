// ─── Server-side session cache (file-based) ─────────────────────────────
// Stores crawl results keyed by username with a configurable TTL so we
// don't re-crawl within the same session. Implements a simple interface
// that can be swapped for Redis / Postgres in production.

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

export function getCached(username: string): CacheEntry | null {
  const key = username.toLowerCase();
  const now = Date.now();

  // Check in-memory first.
  const mem = memCache.get(key);
  if (mem && now - mem.savedAt < cacheConfig.ttlMs) return mem;

  // Check file.
  try {
    const filePath = cacheFilePath(key);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CacheEntry;
      if (now - data.savedAt < cacheConfig.ttlMs) {
        memCache.set(key, data);
        return data;
      }
      // Expired — remove.
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