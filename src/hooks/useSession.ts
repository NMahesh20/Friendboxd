'use client';

// ─── sessionStorage-backed state hook ───────────────────────────────────
// Persists app state in the browser session so a refresh restores the
// user's progress. Data is scoped to the current tab/session only.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalyzeResult, RecommendationResult } from '@/lib/types';

const KEYS = {
  username: 'friendboxd:username',
  selected: 'friendboxd:selected',
  manual: 'friendboxd:manual',
  weights: 'friendboxd:weights',
  genre: 'friendboxd:genre',
  results: 'friendboxd:results',
  discovered: 'friendboxd:discovered',
} as const;

export interface SessionData {
  username: string | null;
  selectedFriendIds: string[];
  manualFriendIds: string[];
  friendWeights: Record<string, number>;
  genre: string | null;
  lastResults: RecommendationResult | null;
  discovered: AnalyzeResult | null;
}

const EMPTY: SessionData = {
  username: null,
  selectedFriendIds: [],
  manualFriendIds: [],
  friendWeights: {},
  genre: null,
  lastResults: null,
  discovered: null,
};

function safeGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage full / unavailable — ignore.
  }
}

function safeRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function loadSession(): SessionData {
  if (typeof window === 'undefined') return EMPTY;
  const parse = <T,>(key: string): T | null => {
    const raw = safeGet(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  return {
    username: safeGet(KEYS.username),
    selectedFriendIds: parse<string[]>(KEYS.selected) ?? [],
    manualFriendIds: parse<string[]>(KEYS.manual) ?? [],
    friendWeights: parse<Record<string, number>>(KEYS.weights) ?? {},
    genre: safeGet(KEYS.genre),
    lastResults: parse<RecommendationResult>(KEYS.results),
    discovered: parse<AnalyzeResult>(KEYS.discovered),
  };
}

export function useSession() {
  const [data, setData] = useState<SessionData>(EMPTY);
  const hydrated = useRef(false);

  // Hydrate once on mount.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    setData(loadSession());
  }, []);

  // Persist on change (after hydration).
  useEffect(() => {
    if (!hydrated.current) return;
    safeSet(KEYS.username, data.username ?? '');
    safeSet(KEYS.selected, JSON.stringify(data.selectedFriendIds));
    safeSet(KEYS.manual, JSON.stringify(data.manualFriendIds));
    safeSet(KEYS.weights, JSON.stringify(data.friendWeights));
    safeSet(KEYS.genre, data.genre ?? '');
    if (data.lastResults) safeSet(KEYS.results, JSON.stringify(data.lastResults));
    else safeRemove(KEYS.results);
    if (data.discovered) safeSet(KEYS.discovered, JSON.stringify(data.discovered));
    else safeRemove(KEYS.discovered);
  }, [data]);

  const setUsername = useCallback((username: string | null) => {
    setData((d) => ({ ...d, username }));
  }, []);

  const setSelected = useCallback((ids: string[]) => {
    setData((d) => ({ ...d, selectedFriendIds: ids }));
  }, []);

  const setManual = useCallback((ids: string[]) => {
    setData((d) => ({ ...d, manualFriendIds: ids }));
  }, []);

  const setWeights = useCallback((weights: Record<string, number>) => {
    setData((d) => ({ ...d, friendWeights: weights }));
  }, []);

  const setGenre = useCallback((genre: string | null) => {
    setData((d) => ({ ...d, genre }));
  }, []);

  const setResults = useCallback((results: RecommendationResult | null) => {
    setData((d) => ({ ...d, lastResults: results }));
  }, []);

  const setDiscovered = useCallback((discovered: AnalyzeResult | null) => {
    setData((d) => ({ ...d, discovered }));
  }, []);

  const reset = useCallback(() => {
    setData(EMPTY);
    for (const key of Object.values(KEYS)) safeRemove(key);
  }, []);

  return {
    ...data,
    hydrated: hydrated.current,
    setUsername,
    setSelected,
    setManual,
    setWeights,
    setGenre,
    setResults,
    setDiscovered,
    reset,
  };
}