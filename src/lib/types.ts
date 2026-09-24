// ─── Shared domain types ────────────────────────────────────────────────

/** A single film as seen on Letterboxd. */
export interface Film {
  /** Letterboxd numeric film id (string to avoid precision loss). */
  id: string;
  /** URL slug, e.g. "the-dark-knight". */
  slug: string;
  title: string;
  year: number | null;
  /** 0.5 – 5 in 0.5 steps, or null when unrated. */
  rating: number | null;
  genres: string[];
  liked?: boolean;
  /** Poster image URL (extracted from Letterboxd HTML). */
  poster?: string;
  /** Short plot synopsis from Letterboxd. */
  synopsis?: string;
  /** Marketing tagline from Letterboxd. */
  tagline?: string;
  /** Director name. */
  director?: string;
  /** Runtime, e.g. "148 min". */
  runtime?: string;
  /** ISO date the film was watched, when available. */
  watchedAt?: string;
  /** Short review text attached to the watch, when available. */
  review?: { text: string; sentiment?: number };
}

/** A Letterboxd user (the user themselves or a friend). */
export interface Friend {
  /** Letterboxd username. */
  id: string;
  /** Display name. */
  name: string;
  avatar?: string;
  bio?: string;
  /** Films the user has watched (capped by crawler config). */
  films: Film[];
  /** Slugs of public lists the user owns. */
  lists?: string[];
  /** Reviews keyed by film slug. */
  reviews?: { filmSlug: string; text: string }[];
  /** True when the profile could not be crawled (private/blocked). */
  unavailable?: boolean;
}

export type MatchLabel = 'excellent' | 'good' | 'mixed' | 'low';

/** Per-signal breakdown of a taste match. All values are 0–1. */
export interface MatchBreakdown {
  ratingOverlap: number;
  genreOverlap: number;
  listOverlap: number;
  reviewConsistency: number;
  recencyWeight: number;
}

/** Taste match between the user and one friend. */
export interface TasteMatch {
  friendId: string;
  friendName: string;
  avatar?: string;
  /** 0–100 overall score. */
  score: number;
  label: MatchLabel;
  breakdown: MatchBreakdown;
  /** Shared films with both ratings (for the UI). */
  sharedFilms: {
    title: string;
    year: number | null;
    userRating: number | null;
    friendRating: number | null;
  }[];
  /** Human-readable explanation of why the score is what it is. */
  explanation: string;
}

/** A friend who influenced a candidate movie. */
export interface Influence {
  friendId: string;
  friendName: string;
  friendScore: number;
  friendRating: number | null;
}

/**
 * A film the AI suggested as a look-alike ("more like this"). The AI always
 * returns a real Letterboxd URL, and the app resolves the poster + average
 * rating from that film's page so the suggestion is fully displayable.
 */
export interface SuggestedFilm {
  title: string;
  year?: number | null;
  /** Real Letterboxd film URL (https://letterboxd.com/film/<slug>/). */
  letterboxdUrl?: string;
  /** The film's Letterboxd slug (derived from letterboxdUrl). */
  slug?: string;
  /** Real poster, resolved from the Letterboxd film page. */
  poster?: string;
  /** Letterboxd average rating (0.5–5), resolved from the film page. */
  rating?: number | null;
}

/** A candidate movie with scoring + AI enrichment. */
export interface CandidateMovie {
  film: Film;
  /** 0–100 composite score. */
  score: number;
  /** Deterministic reasons (short strings). */
  reasons: string[];
  influencedBy: Influence[];
  /** 0–1 relevance to the chosen genre/mood. */
  genreRelevance: number;
  /** AI-generated enrichment (present when the AI layer ran). */
  ai?: {
    reason: string;
    moreLikeThis: SuggestedFilm[];
  };
}

export interface RecommendationResult {
  candidates: CandidateMovie[];
  genre: string;
  generatedAt: string;
  aiUsed: boolean;
  /** Whether an AI provider API key is configured (Gemini → AI features on). */
  aiEnabled: boolean;
  /** True when the pool was too small to be meaningful. */
  degraded?: boolean;
  /** Human-readable reason the AI layer failed (null = OK / no key). */
  aiError?: string | null;
}

/** Result of the analyze step. */
export interface AnalyzeResult {
  user: Friend;
  friends: Friend[];
  matches: TasteMatch[];
  /** Warnings surfaced to the UI (e.g. crawl was blocked). */
  warnings: string[];
  /** True when crawling was blocked and only manual input is possible. */
  blocked: boolean;
}

// ─── Client-side session state ──────────────────────────────────────────

export interface SessionState {
  username: string | null;
  /** Selected friend ids (max 5, includes manual). */
  selectedFriendIds: string[];
  /** Manually added friend ids. */
  manualFriendIds: string[];
  /** Custom weight (0–100, default 50) per selected friend id. */
  friendWeights: Record<string, number>;
  genre: string | null;
  /** Last recommendation results (restored on refresh). */
  lastResults: RecommendationResult | null;
  /** Discovered friends + matches (restored on refresh). */
  discovered: AnalyzeResult | null;
}