// ─── Live crawl status (for the loading UI) ─────────────────────────────
// The crawler reports the phase it's in plus *who* it's working on (a
// Letterboxd username) and *what* (a film title). A tiny GET /api/status
// endpoint exposes it so the dashboard can show neat one-liners while
// requests run.
//
// SECURITY: the phase line is always a whitelisted constant string below.
// Usernames are input-validated to [a-z0-9_] upstream, and film titles come
// from crawled pages — both are surfaced to the UI as plain text only (the
// React client renders them as escaped text, never markup), and both are
// length-capped here so nothing oversized can be echoed back. We never set
// phase text from URLs, counts or error text.

export type CrawlPhase =
  | 'profile'
  | 'following'
  | 'watchlist'
  | 'lists'
  | 'friends'
  | 'matching'
  | 'genre'
  | 'posters';

const LINES: Record<CrawlPhase, string> = {
  profile: 'Finding your profile…',
  following: 'Discovering who you follow…',
  watchlist: 'Reading your watchlist…',
  lists: 'Scanning your lists…',
  friends: 'Reading friends’ watchlists…',
  matching: 'Matching your taste…',
  genre: 'Fetching genre picks…',
  posters: 'Polishing poster art…',
};

export interface CrawlStatus {
  /** Whitelisted phase line (or null when idle). */
  line: string | null;
  /** Username currently being crawled (or null). */
  user: string | null;
  /** Film title currently being processed (or null). */
  film: string | null;
}

let phase: CrawlPhase | null = null;
let user: string | null = null;
let film: string | null = null;

/** Report the current crawl phase (server-side only). */
export function setCrawlPhase(p: CrawlPhase): void {
  phase = p;
}

/** Report which user the crawl is currently working on. */
export function setCrawlUser(u: string | null): void {
  // Letterboxd usernames are ≤40 chars after validation; belt-and-braces cap.
  user = u ? u.slice(0, 40) : null;
}

/** Report which film the crawl is currently processing. */
export function setCrawlFilm(f: string | null): void {
  film = f && f.length > 80 ? `${f.slice(0, 77)}…` : f;
}

/** Clear the phase — call once the crawl finishes (success or failure). */
export function clearCrawlPhase(): void {
  phase = null;
  user = null;
  film = null;
}

/** Safe snapshot for the status endpoint. */
export function getCrawlStatus(): CrawlStatus {
  return {
    line: phase ? LINES[phase] : null,
    user,
    film,
  };
}