'use client';

// ─── Client-side API helpers ────────────────────────────────────────────

import type { AnalyzeResult, CandidateMovie, Friend, RecommendationResult } from '@/lib/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Network error — check your connection and try again.', 0);
  }

  let data: { error?: string } & T;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('Unexpected response from the server.', res.status);
  }

  if (!res.ok) {
    throw new ApiError(data.error ?? 'Something went wrong. Please try again.', res.status);
  }
  return data;
}

export function analyzeTaste(username: string, matchTaste = false): Promise<AnalyzeResult> {
  return post<AnalyzeResult>('/api/analyze', { username, matchTaste });
}

export function validateFriend(username: string): Promise<{ friend: Friend }> {
  return post<{ friend: Friend }>('/api/friends', { username });
}

export function getRecommendations(
  username: string,
  friendIds: string[],
  genre: string,
  weights?: Record<string, number>,
): Promise<RecommendationResult> {
  return post<RecommendationResult>('/api/recommend', { username, friendIds, genre, weights });
}

/** Re-run the AI layer on the current picks to refresh reasons + look-alikes. */
export function refineRecommendations(
  candidates: CandidateMovie[],
  genre: string,
): Promise<{ candidates: CandidateMovie[]; aiUsed: boolean; aiError?: string | null }> {
  return post<{ candidates: CandidateMovie[]; aiUsed: boolean; aiError?: string | null }>(
    '/api/refine',
    { candidates, genre },
  );
}