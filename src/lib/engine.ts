// ─── Orchestration engine ───────────────────────────────────────────────
// Ties together the crawler, scoring, candidate generation, AI layer and
// server-side cache. Kept stateless: every request carries the data it
// needs (username, friend ids, genre).

import { crawlUser, crawlFriend, enrichFilmsWithGenres } from '@/lib/crawler/letterboxd';
import { computeTasteMatches } from '@/lib/scoring/taste-match';
import { generateCandidates } from '@/lib/scoring/candidates';
import { enrichWithAi } from '@/lib/ai/recommender';
import { getCached, setCached, type CacheEntry } from '@/lib/storage/cache';
import { resolveMood } from '@/lib/utils/genres';
import { RECOMMENDATION_COUNT } from '@/lib/config';
import type {
  AnalyzeResult,
  CandidateMovie,
  Friend,
  RecommendationResult,
  TasteMatch,
} from '@/lib/types';

// ─── Analyze ────────────────────────────────────────────────────────────

export async function analyzeTaste(username: string): Promise<AnalyzeResult> {
  const cached = getCached(username);
  if (cached) {
    return {
      user: cached.user,
      friends: cached.friends,
      matches: cached.matches,
      warnings: [],
      blocked: false,
    };
  }

  const crawl = await crawlUser(username);
  const matches = computeTasteMatches(crawl.user.films, crawl.friends, crawl.user.lists);

  setCached(username, { user: crawl.user, friends: crawl.friends, matches });

  return {
    user: crawl.user,
    friends: crawl.friends,
    matches,
    warnings: crawl.warnings,
    blocked: crawl.blocked,
  };
}

// ─── Manual friend ──────────────────────────────────────────────────────

export async function fetchManualFriend(username: string): Promise<Friend> {
  return crawlFriend(username);
}

// ─── Recommend ──────────────────────────────────────────────────────────

export async function recommendMovies(
  username: string,
  friendIds: string[],
  genreMood: string,
  weights: Record<string, number> = {},
): Promise<RecommendationResult> {
  // Load user + friends from cache (or crawl fresh if missing).
  let cached = getCached(username);
  if (!cached) {
    const crawl = await crawlUser(username);
    const matches = computeTasteMatches(crawl.user.films, crawl.friends, crawl.user.lists);
    const fresh: CacheEntry = {
      user: crawl.user,
      friends: crawl.friends,
      matches,
      savedAt: Date.now(),
    };
    setCached(username, fresh);
    cached = fresh;
  }

  const { user, friends, matches } = cached;

  // Build the selected friend set (discovered + manual).
  const matchById = new Map(matches.map((m) => [m.friendId, m]));
  const friendById = new Map(friends.map((f) => [f.id, f]));

  const selected: {
    id: string;
    name: string;
    films: Friend['films'];
    matchScore: number;
    weight: number;
  }[] = [];

  for (const id of friendIds) {
    const match = matchById.get(id);
    const friend = friendById.get(id);
    const weight = weights[id] ?? 50;
    if (friend) {
      selected.push({
        id: friend.id,
        name: friend.name,
        films: friend.films,
        matchScore: match?.score ?? 50,
        weight,
      });
    } else {
      // Manual friend not in the cached crawl — fetch it fresh.
      try {
        const manual = await crawlFriend(id);
        selected.push({
          id: manual.id,
          name: manual.name,
          films: manual.films,
          matchScore: match?.score ?? 50,
          weight,
        });
      } catch {
        // Skip unavailable manual friends.
      }
    }
  }

  if (selected.length === 0) {
    throw new Error('No valid friends selected. Please select at least one friend.');
  }

  // Generate candidates.
  let candidates = generateCandidates(selected, user.films, genreMood);

  // Enrich top candidates with genres (fetch film pages) for better scoring.
  const topForEnrich = candidates.slice(0, 15).map((c) => c.film);
  const enrichedFilms = await enrichFilmsWithGenres(topForEnrich, 15);
  const enrichedBySlug = new Map(enrichedFilms.map((f) => [f.slug, f]));
  candidates = candidates.map((c) => {
    const enriched = enrichedBySlug.get(c.film.slug);
    return enriched ? { ...c, film: enriched } : c;
  });

  // Re-rank after genre enrichment.
  candidates = reRankByGenre(candidates, genreMood);

  // AI refinement.
  const { candidates: aiCandidates, aiUsed } = await enrichWithAi(
    candidates,
    matches,
    genreMood,
  );

  const degraded = aiCandidates.length < 3;

  return {
    candidates: aiCandidates.slice(0, RECOMMENDATION_COUNT),
    genre: genreMood,
    generatedAt: new Date().toISOString(),
    aiUsed,
    degraded,
  };
}

/** Re-rank candidates so genre-relevant films float to the top. */
function reRankByGenre(candidates: CandidateMovie[], genreMood: string): CandidateMovie[] {
  const { genres } = resolveMood(genreMood);
  if (genres.length === 0) return candidates;

  const normalized = new Set(genres.map((g) => g.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const scored = candidates.map((c) => {
    const filmGenres = new Set(c.film.genres.map((g) => g.toLowerCase().replace(/[^a-z0-9]/g, '')));
    let boost = 0;
    for (const g of normalized) if (filmGenres.has(g)) boost = 1;
    return { c, boost };
  });
  return scored
    .sort((a, b) => b.boost - a.boost || b.c.score - a.c.score)
    .map((s) => s.c);
}