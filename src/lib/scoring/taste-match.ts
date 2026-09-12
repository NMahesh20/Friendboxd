// ─── Taste-match scoring ────────────────────────────────────────────────
// Computes a 0–100 similarity score between the user and each friend
// using five signals: rating overlap, genre overlap, list overlap,
// review consistency, and recency weight.

import type { Film, TasteMatch, MatchBreakdown, MatchLabel } from '@/lib/types';
import { normalizeGenre } from '@/lib/utils/genres';

// ─── Signal weights ─────────────────────────────────────────────────────

const WEIGHTS = {
  ratingOverlap: 0.3,
  genreOverlap: 0.3,
  listOverlap: 0.15,
  reviewConsistency: 0.1,
  recencyWeight: 0.15,
} as const;

// ─── Individual signals ─────────────────────────────────────────────────

/** Jaccard similarity on the set of film slugs both have rated. */
function ratingOverlap(a: Film[], b: Film[]): number {
  const mapA = new Map<string, number>();
  for (const f of a) if (f.rating != null) mapA.set(f.slug, f.rating);
  const mapB = new Map<string, number>();
  for (const f of b) if (f.rating != null) mapB.set(f.slug, f.rating);

  const shared = [...mapA.keys()].filter((k) => mapB.has(k));
  if (shared.length === 0) return 0;

  // Agreement: how many shared films have ratings within 1 star.
  let agreement = 0;
  for (const slug of shared) {
    const diff = Math.abs(mapA.get(slug)! - mapB.get(slug)!);
    agreement += diff <= 1 ? 1 - diff / 5 : 0;
  }

  // Jaccard overlap bonus.
  const unionSize = mapA.size + mapB.size - shared.length;
  const jaccard = shared.length / Math.max(unionSize, 1);

  return Math.min(1, (agreement / shared.length) * 0.6 + jaccard * 0.4);
}

/** Cosine similarity on genre frequency vectors. */
function genreOverlap(a: Film[], b: Film[]): number {
  const freqA = new Map<string, number>();
  const freqB = new Map<string, number>();
  for (const f of a) for (const g of f.genres) freqA.set(normalizeGenre(g), (freqA.get(normalizeGenre(g)) ?? 0) + 1);
  for (const f of b) for (const g of f.genres) freqB.set(normalizeGenre(g), (freqB.get(normalizeGenre(g)) ?? 0) + 1);

  const keys = new Set([...freqA.keys(), ...freqB.keys()]);
  if (keys.size === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const k of keys) {
    const va = freqA.get(k) ?? 0;
    const vb = freqB.get(k) ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Jaccard similarity on list slugs. */
function listOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0.5; // neutral
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Review text length + rate consistency as a proxy for consistency. */
function reviewConsistency(a: Film[], b: Film[]): number {
  const hasReviewA = a.filter((f) => f.review && f.review.text.length > 0).length;
  const hasReviewB = b.filter((f) => f.review && f.review.text.length > 0).length;
  if (hasReviewA === 0 && hasReviewB === 0) return 0.5;
  const rateA = hasReviewA / Math.max(a.length, 1);
  const rateB = hasReviewB / Math.max(b.length, 1);
  return 1 - Math.abs(rateA - rateB);
}

/** Recency weight: more recent shared activity → higher score. */
function recencyWeight(a: Film[], b: Film[]): number {
  const recentSlugs = new Set<string>();
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000; // 180 days
  for (const f of a) {
    if (f.watchedAt && new Date(f.watchedAt).getTime() > cutoff) recentSlugs.add(f.slug);
  }
  let shared = 0;
  let recent = 0;
  const bSlugs = new Set(b.map((f) => f.slug));
  for (const slug of recentSlugs) {
    if (bSlugs.has(slug)) {
      shared++;
      recent++;
    }
  }
  // Also check non-recent shared.
  for (const f of a) {
    if (!recentSlugs.has(f.slug) && bSlugs.has(f.slug)) shared++;
  }
  if (shared === 0) return 0;
  return recent / shared;
}

// ─── Composite score ────────────────────────────────────────────────────

function scoreToLabel(score: number): MatchLabel {
  if (score >= 75) return 'excellent';
  if (score >= 50) return 'good';
  if (score >= 25) return 'mixed';
  return 'low';
}

function buildExplanation(breakdown: MatchBreakdown, sharedCount: number): string {
  const parts: string[] = [];
  if (sharedCount > 0) {
    parts.push(`You and this friend share ${sharedCount} rated film${sharedCount === 1 ? '' : 's'}`);
  }
  if (breakdown.genreOverlap > 0.6) {
    parts.push('your genre tastes strongly overlap');
  } else if (breakdown.genreOverlap > 0.3) {
    parts.push('you enjoy many similar genres');
  }
  if (breakdown.ratingOverlap > 0.6) {
    parts.push('and you tend to rate films similarly');
  } else if (breakdown.ratingOverlap > 0.3) {
    parts.push('with some agreement on quality');
  }
  if (breakdown.recencyWeight > 0.6) {
    parts.push('especially recently');
  }
  if (parts.length === 0) {
    parts.push('your viewing patterns show some overlap');
  }
  return parts.join(', ') + '.';
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Compute taste matches between the user and a list of friends.
 * Returns matches sorted by score (best first).
 */
export function computeTasteMatches(
  userFilms: Film[],
  friends: { id: string; name: string; avatar?: string; films: Film[]; lists?: string[] }[],
  userLists: string[] = [],
): TasteMatch[] {
  const matches: TasteMatch[] = [];

  for (const friend of friends) {
    if (friend.films.length === 0 && (!friend.lists || friend.lists.length === 0)) {
      matches.push({
        friendId: friend.id,
        friendName: friend.name,
        avatar: friend.avatar,
        score: 0,
        label: 'low',
        breakdown: {
          ratingOverlap: 0,
          genreOverlap: 0,
          listOverlap: 0,
          reviewConsistency: 0,
          recencyWeight: 0,
        },
        sharedFilms: [],
        explanation: 'Not enough data to compute a match score.',
      });
      continue;
    }

    const rOverlap = ratingOverlap(userFilms, friend.films);
    const gOverlap = genreOverlap(userFilms, friend.films);
    const lOverlap = listOverlap(userLists, friend.lists ?? []);
    const rc = reviewConsistency(userFilms, friend.films);
    const rw = recencyWeight(userFilms, friend.films);

    const breakdown: MatchBreakdown = {
      ratingOverlap: rOverlap,
      genreOverlap: gOverlap,
      listOverlap: lOverlap,
      reviewConsistency: rc,
      recencyWeight: rw,
    };

    const score01 =
      rOverlap * WEIGHTS.ratingOverlap +
      gOverlap * WEIGHTS.genreOverlap +
      lOverlap * WEIGHTS.listOverlap +
      rc * WEIGHTS.reviewConsistency +
      rw * WEIGHTS.recencyWeight;
    const score = Math.round(Math.min(100, score01 * 100 * 1.2)); // slight boost to reach 100

    // Shared rated films for the UI.
    const userRated = new Map(userFilms.filter((f) => f.rating != null).map((f) => [f.slug, f]));
    const sharedFilms = friend.films
      .filter((f) => f.rating != null && userRated.has(f.slug))
      .map((f) => ({
        title: f.title,
        year: f.year,
        userRating: userRated.get(f.slug)!.rating!,
        friendRating: f.rating!,
      }));

    const label = scoreToLabel(score);
    const explanation = buildExplanation(breakdown, sharedFilms.length);

    matches.push({
      friendId: friend.id,
      friendName: friend.name,
      avatar: friend.avatar,
      score,
      label,
      breakdown,
      sharedFilms,
      explanation,
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}