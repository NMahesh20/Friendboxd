// ─── Candidate movie generation ─────────────────────────────────────────
// Given the selected friends, the user's watched films, a genre/mood, and
// taste-match scores, compute the top candidate movies the user might
// enjoy. Handles duplicate films, recency weighting, genre boosting, and
// friend-influence attribution.

import type { Film, CandidateMovie, Influence, TasteMatch } from '@/lib/types';
import { resolveMood } from '@/lib/utils/genres';
import { normalizeGenre } from '@/lib/utils/genres';
import { CANDIDATE_POOL_SIZE } from '@/lib/config';

/**
 * Compute how relevant a film is to the selected genre/mood (0–1).
 * 0 = no match, 0.5 = partial overlap, 0.7 = keyword match, 1 = exact genre.
 * Returns 0.5 (neutral) when no genre/mood filter is active.
 *
 * Shared by candidate generation (soft boost) and the post-enrichment
 * hard filter, so both use the exact same matching rules.
 */
export function computeGenreRelevance(film: Film, genreMood: string): number {
  const { genres, keywords } = resolveMood(genreMood);
  const normalizedGenres = new Set(genres.map(normalizeGenre));
  const keywordLower = keywords.map((k) => k.toLowerCase());

  if (normalizedGenres.size === 0 && keywordLower.length === 0) {
    return 0.5; // neutral when no genre filter
  }

  const filmGenres = new Set(film.genres.map(normalizeGenre));
  let relevance = 0;

  // Exact genre match.
  for (const g of normalizedGenres) {
    if (filmGenres.has(g)) relevance = 1;
  }
  // Keyword match against title.
  const titleLower = film.title.toLowerCase();
  for (const kw of keywordLower) {
    if (titleLower.includes(kw)) relevance = Math.max(relevance, 0.7);
  }
  // Partial genre overlap.
  if (relevance === 0) {
    for (const fg of filmGenres) {
      for (const g of normalizedGenres) {
        if (fg.includes(g) || g.includes(fg)) relevance = Math.max(relevance, 0.5);
      }
    }
  }
  return relevance;
}

/** Compute candidate movies from friends' filmographies. */
export function generateCandidates(
  selectedFriends: {
    id: string;
    name: string;
    films: Film[];
    matchScore: number;
    /** Custom weight 0–100 (default 50 = neutral). */
    weight?: number;
  }[],
  userWatched: Film[],
  genreMood: string,
): CandidateMovie[] {
  const excludeSlugs = new Set(userWatched.map((f) => f.slug));

  // Aggregate scores per film slug.
  const filmMap = new Map<
    string,
    {
      film: Film;
      influence: Influence[];
      totalScore: number;
      genreHits: number;
      friendCount: number;
    }
  >();

  for (const friend of selectedFriends) {
    // Custom weight scales the friend's influence: 50 = neutral (1×),
    // 100 = 2×, 25 = 0.5×, 0 = excluded.
    const weight = friend.weight ?? 50;
    const fScore = (friend.matchScore / 100) * (weight / 50);

    for (const film of friend.films) {
      if (excludeSlugs.has(film.slug)) continue;
      if (filmMap.has(film.slug) && filmMap.get(film.slug)!.influence.some((i) => i.friendId === friend.id)) continue;

      // Friend's own rating normalized to 0–1 (default 0.6 if unrated).
      const fRating = film.rating != null ? film.rating / 5 : 0.6;
      const watchRecencyBoost = film.watchedAt
        ? Math.max(0.5, 1 - (Date.now() - new Date(film.watchedAt).getTime()) / (365 * 24 * 60 * 60 * 1000) * 0.3)
        : 0.6;

      // Genre relevance (0–1). The boost is strong so genre-matching films
      // dominate the pool and unrelated genres are pushed out.
      const genreRelevance = computeGenreRelevance(film, genreMood);
      const baseScore = fScore * fRating * watchRecencyBoost * (0.15 + genreRelevance * 0.85);
      const influence: Influence = {
        friendId: friend.id,
        friendName: friend.name,
        friendScore: friend.matchScore,
        friendRating: film.rating,
      };

      const existing = filmMap.get(film.slug);
      if (existing) {
        existing.totalScore += baseScore;
        existing.influence.push(influence);
        existing.genreHits = Math.max(existing.genreHits, genreRelevance);
        existing.friendCount++;
      } else {
        filmMap.set(film.slug, {
          film,
          influence: [influence],
          totalScore: baseScore,
          genreHits: genreRelevance,
          friendCount: 1,
        });
      }
    }
  }

  // Sort and take the pool.
  const candidates = [...filmMap.values()]
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, CANDIDATE_POOL_SIZE);

  // Normalize scores to 0–100.
  const maxScore = candidates.length > 0 ? candidates[0].totalScore : 1;

  return candidates.map((c) => {
    const normalizedScore = Math.round((c.totalScore / maxScore) * 100);
    const reasons: string[] = [];

    if (c.friendCount > 1) {
      reasons.push(`Recommended by ${c.friendCount} friends`);
    } else {
      reasons.push(`Matched by ${c.influence[0].friendName}`);
    }
    if (c.genreHits > 0.8) reasons.push('Matches your genre choice');
    else if (c.genreHits > 0) reasons.push('Partially matches your mood');
    if (c.film.rating && c.film.rating >= 4) reasons.push(`Rated ${c.film.rating}★ on Letterboxd`);
    if (c.film.liked) reasons.push('A Letterboxd favorite');

    return {
      film: c.film,
      score: normalizedScore,
      reasons,
      influencedBy: c.influence.sort((a, b) => b.friendScore - a.friendScore),
      genreRelevance: c.genreHits,
    };
  });
}