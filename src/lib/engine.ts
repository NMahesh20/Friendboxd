// ─── Orchestration engine ───────────────────────────────────────────────
// Ties together the crawler, scoring, candidate generation, AI layer and
// server-side cache. Kept stateless: every request carries the data it
// needs (username, friend ids, genre).

import {
  crawlUser,
  crawlFriend,
  crawlFriendGenreFilms,
  enrichFilmsWithGenres,
} from '@/lib/crawler/letterboxd';
import { computeTasteMatches } from '@/lib/scoring/taste-match';
import { generateCandidates, computeGenreRelevance } from '@/lib/scoring/candidates';
import { getCached, setCached, type CacheEntry } from '@/lib/storage/cache';
import { markCrawlStart, markCrawlEnd } from '@/lib/keepalive';
import { setCrawlPhase, clearCrawlPhase } from '@/lib/crawl-status';
import { resolveMood, genresForUrl } from '@/lib/utils/genres';
import { RECOMMENDATION_COUNT, aiConfig, crawlerConfig } from '@/lib/config';
import type {
  AnalyzeResult,
  CandidateMovie,
  Friend,
  RecommendationResult,
  TasteMatch,
} from '@/lib/types';

// ─── Analyze ────────────────────────────────────────────────────────────

export async function analyzeTaste(
  username: string,
  opts: { matchTaste?: boolean } = {},
): Promise<AnalyzeResult> {
  // Keep the Render instance awake while the crawl runs (see keepalive.ts).
  markCrawlStart();
  try {
    return await analyzeTasteImpl(username, opts);
  } finally {
    markCrawlEnd();
    clearCrawlPhase();
  }
}

async function analyzeTasteImpl(
  username: string,
  opts: { matchTaste?: boolean } = {},
): Promise<AnalyzeResult> {
  // Full mode (matchTaste) is cached; light mode always re-crawls (it's fast).
  const matchTaste = opts.matchTaste !== false;
  const cached = matchTaste ? getCached(username) : null;
  if (cached) {
    return {
      user: cached.user,
      friends: cached.friends,
      matches: cached.matches,
      warnings: [],
      blocked: false,
    };
  }

  const crawl = await crawlUser(username, { matchTaste });
  if (matchTaste) setCrawlPhase('matching');
  const matches = matchTaste
    ? computeTasteMatches(crawl.user.films, crawl.friends, crawl.user.lists)
    : [];

  // Only cache healthy crawls — a blocked/empty crawl must not become the
  // cached "result" served to every later request.
  if (matchTaste && !crawl.blocked) setCached(username, { user: crawl.user, friends: crawl.friends, matches });

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
  markCrawlStart();
  try {
    return await fetchManualFriendImpl(username);
  } finally {
    markCrawlEnd();
    clearCrawlPhase();
  }
}

async function fetchManualFriendImpl(username: string): Promise<Friend> {
  return crawlFriend(username);
}

// ─── Recommend ──────────────────────────────────────────────────────────

export async function recommendMovies(
  username: string,
  friendIds: string[],
  genreMood: string,
  weights: Record<string, number> = {},
): Promise<RecommendationResult> {
  // Keep the Render instance awake while the crawl runs (see keepalive.ts).
  markCrawlStart();
  try {
    return await recommendMoviesImpl(username, friendIds, genreMood, weights);
  } finally {
    markCrawlEnd();
    clearCrawlPhase();
  }
}

async function recommendMoviesImpl(
  username: string,
  friendIds: string[],
  genreMood: string,
  weights: Record<string, number> = {},
): Promise<RecommendationResult> {
  // Load user + friends from cache (or crawl fresh if missing).
  let cached = getCached(username);
  if (!cached) {
    // Cache missed (e.g. light analyze never caches) — do NOT run the full
    // network crawl here. That was fetching every discovered friend's
    // watchlist (up to maxFriends) even though the user only selected a
    // few. We only need the user's OWN films for the watched-exclusion
    // set; each selected friend's films are fetched individually below.
    let userFilms: Friend;
    try {
      // Reuse the manual-friend crawl: profile + films, capped deeper so
      // the exclusion set is as complete as before.
      userFilms = await crawlFriend(username, { maxPages: crawlerConfig.maxUserPages });
    } catch {
      // Blocked/private profile — degrade to an empty watchlist rather
      // than failing the whole request.
      userFilms = { id: username, name: username, films: [] } as Friend;
    }
    cached = {
      user: userFilms,
      friends: [], // filled per selected id below
      matches: [], // taste-match needs the full network crawl; scores default to 50
      savedAt: Date.now(),
    };
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
    if (friend && friend.films.length > 0) {
      selected.push({
        id: friend.id,
        name: friend.name,
        films: friend.films,
        matchScore: match?.score ?? 50,
        weight,
      });
    } else {
      // Friend has no films (light analyze) or isn't in the cached crawl —
      // fetch it fresh so recommendations always have watchlist data.
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

  // Genre-filtered crawl: fetch each friend's top films in the selected
  // genre (sorted by their rating via /by/entry-rating/). This guarantees
  // every candidate matches the chosen genre without slow per-film genre
  // enrichment. Falls back to the friend's full list when the genre crawl
  // is blocked or empty.
  const genreNames = genresForUrl(genreMood);
  let genreSelected: typeof selected = selected;
  if (genreNames.length > 0) {
    genreSelected = [];
    for (const friend of selected) {
      try {
        const films = await crawlFriendGenreFilms(friend.id, genreNames, 20);
        genreSelected.push(
          films.length > 0
            ? {
                ...friend,
                // Tag films with the crawled genres so relevance scoring is exact.
                films: films.map((f) => ({ ...f, genres: [...genreNames] })),
              }
            : friend,
        );
      } catch {
        genreSelected.push(friend);
      }
    }
  }

  // Generate candidates.
  let candidates = generateCandidates(genreSelected, user.films, genreMood);

  // Enrich candidates with genres + real posters (fetch film pages). This
  // fetches films missing genres OR still carrying the empty poster
  // placeholder. Limit to 12 to stay within the API timeout on Render.
  const topForEnrich = candidates.slice(0, 12).map((c) => c.film);
  const enrichedFilms = await enrichFilmsWithGenres(topForEnrich, 12);
  const enrichedBySlug = new Map(enrichedFilms.map((f) => [f.slug, f]));
  candidates = candidates.map((c) => {
    const enriched = enrichedBySlug.get(c.film.slug);
    return enriched ? { ...c, film: enriched } : c;
  });

  // Recompute genre relevance now that films carry real genres, then
  // hard-filter out films that don't match the selected genre/mood.
  const { genres: moodGenres } = resolveMood(genreMood);
  const hasMood = moodGenres.length > 0;
  candidates = candidates.map((c) => {
    const relevance = computeGenreRelevance(c.film, genreMood);
    const reasons = c.reasons.filter(
      (r) => r !== 'Matches your genre choice' && r !== 'Partially matches your mood',
    );
    if (hasMood) {
      if (relevance > 0.8) reasons.push('Matches your genre choice');
      else if (relevance > 0) reasons.push('Partially matches your mood');
    }
    return { ...c, genreRelevance: relevance, reasons };
  });

  if (hasMood) {
    const matching = candidates.filter((c) => c.genreRelevance > 0);
    // Hard-filter only when enough matches remain; otherwise keep the best
    // candidates so the user still gets recommendations.
    if (matching.length >= 3) candidates = matching;
  }

  // Re-rank after genre enrichment.
  candidates = reRankByGenre(candidates, genreMood);

  // No AI call here — Gemini is consulted ONLY on explicit user actions
  // ("More like this", "✨ More movies", or a free-text mood description).
  // The initial recommendation is purely crawl + deterministic scoring.
  const aiUsed = false;
  const aiError: string | null = null;
  const degraded = candidates.length < 3;

  // Hard guarantee: never recommend a film the user has already watched.
  // Candidates are already excluded during generation; this is a final
  // safety net (matches by slug, with a title+year fallback).
  const watchedSlugs = new Set(user.films.map((f) => f.slug));
  const watchedKeys = new Set(
    user.films.map((f) => `${f.title.toLowerCase()}|${f.year ?? ''}`),
  );
  const unseen = candidates.filter((c) => {
    if (watchedSlugs.has(c.film.slug)) return false;
    return !watchedKeys.has(`${c.film.title.toLowerCase()}|${c.film.year ?? ''}`);
  });

  return {
    candidates: unseen.slice(0, RECOMMENDATION_COUNT),
    genre: genreMood,
    generatedAt: new Date().toISOString(),
    aiUsed,
    aiEnabled: !!aiConfig.apiKey,
    degraded,
    aiError,
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