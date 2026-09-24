// ─── Letterboxd crawler ─────────────────────────────────────────────────
// Orchestrates stealth fetching (HTTP → browser fallback) and parses the
// server-rendered HTML into typed domain objects. Handles private/blocked
// profiles gracefully and throttles every request.

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { crawlerConfig } from '@/lib/config';
import { fetchHtml, HttpFetchError } from './http';
import { fetchHtmlStealth, rotateBrowserSession } from './browser';
import { rateLimiter } from './rate-limiter';
import { genreSlug } from '@/lib/utils/genres';
import type { Film, Friend } from '@/lib/types';

const BASE = 'https://letterboxd.com';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CrawlOptions {
  /** Max films to collect per user. */
  maxFilms?: number;
  /** Max friends to analyze. */
  maxFriends?: number;
  /** Max pagination pages per collection. */
  maxPages?: number;
  /** Max pages for the user's OWN watchlist (exclusion set). */
  maxUserPages?: number;
  /** Collect lists + reviews too (slower). */
  deep?: boolean;
  /** Crawl friends' watchlists + compute taste matches (default true). */
  matchTaste?: boolean;
}

export interface CrawlResult {
  user: Friend;
  friends: Friend[];
  warnings: string[];
  blocked: boolean;
}

export class ProfileNotFoundError extends Error {
  constructor(username: string) {
    super(`No Letterboxd profile found for “${username}”.`);
    this.name = 'ProfileNotFoundError';
  }
}

export class PrivateProfileError extends Error {
  constructor(username: string) {
    super(`The profile “${username}” is private or locked.`);
    this.name = 'PrivateProfileError';
  }
}

// ─── HTML fetching with stealth fallback ────────────────────────────────

async function getHtml(
  url: string,
  referer?: string,
  opts: { waitForPosters?: boolean } = {},
): Promise<string> {
  // Polite rate limit — at most `rateMax` requests per `rateWindowMs`
  // (default 4 per 10s, see crawlerConfig). Applies to both HTTP and
  // browser strategies.
  await rateLimiter.acquire();
  const mode = crawlerConfig.mode;
  if (mode === 'browser') {
    const html = await fetchHtmlStealth(url, opts);
    if (html) return html;
    // The browser served a block/challenge (or is unavailable) — expose it
    // like the HTTP strategy does so the caller can degrade gracefully
    // (surface a warning / skip the film) instead of parsing a challenge
    // page as empty data.
    throw new HttpFetchError('Blocked by Letterboxd (HTTP 403)', 403, false);
  }
  try {
    return (await fetchHtml(url, { referer })).html;
  } catch (err) {
    console.warn('[crawler] HTTP failed, browser fallback:', url, (err as Error).message);
    if (mode === 'http') throw err;
    // A 403 is Cloudflare's "Just a moment" challenge — session-based, so a
    // fallback in the SAME flagged session would fail too. Rotate to a fresh
    // identity first, then let the browser try.
    if (err instanceof HttpFetchError && err.status === 403) {
      rotateBrowserSession();
      const html = await fetchHtmlStealth(url, opts);
      if (html) return html;
      throw err;
    }
    // auto → try stealth browser as fallback.
    const html = await fetchHtmlStealth(url, opts);
    if (html) return html;
    throw err;
  }
}

// ─── Parsers ────────────────────────────────────────────────────────────
// All parsers are written defensively: they try the current Letterboxd
// markup first and fall back to older structures, so small UI changes
// don't break the whole crawl.

/**
 * Parse a rating from a rating element. Handles title attributes
 * ("Rated 3.5 out of 5"), data-rating, the `rated-N` class (N = rating × 2)
 * and literal star text (★★★½ → 3.5).
 */
function parseRating($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): number | null {
  const title = el.attr('title') ?? '';
  const m = title.match(/Rated\s+([\d.]+)\s+out of 5/i);
  if (m) return parseFloat(m[1]);

  const data = el.attr('data-rating');
  if (data) {
    const n = parseFloat(data);
    if (Number.isFinite(n)) return n;
  }

  const cls = el.attr('class') ?? '';
  const rated = cls.match(/rated-(\d+)/);
  // Letterboxd encodes the rating as rating × 2 (e.g. `rated-7` = 3.5★).
  if (rated) return parseInt(rated[1], 10) / 2;

  // Literal star text: ★★★½ → 3.5, ★★ → 2, ½ → 0.5.
  const text = el.text().trim();
  if (text.includes('★') || text.includes('½')) {
    const full = (text.match(/★/g) ?? []).length;
    const half = text.includes('½') ? 0.5 : 0;
    if (full > 0 || half > 0) return full + half;
  }

  return null;
}

/** Extract a film slug from a URL path like "/film/the-dark-knight/". */
function slugFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const parts = href.split('/').filter(Boolean);
  const idx = parts.indexOf('film');
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  return parts[parts.length - 1] || null;
}

/** Parse "Tony (2026)" → { title: "Tony", year: 2026 }. */
function splitTitleYear(fullName: string): { title: string; year: number | null } {
  const yearMatch = fullName.match(/\((\d{4})\)\s*$/);
  if (yearMatch) {
    return {
      title: fullName.slice(0, yearMatch.index).trim(),
      year: parseInt(yearMatch[1], 10),
    };
  }
  return { title: fullName.trim(), year: null };
}

/**
 * True when a poster URL is Letterboxd's empty placeholder (a gray box
 * shipped in the initial HTML) rather than a real poster. The real poster
 * is only available from the film page's og:image, so list-page posters
 * that are still placeholders should be treated as missing.
 */
function isEmptyPoster(src: string | undefined): boolean {
  return !!src && src.includes('/static/img/empty-poster');
}

/**
 * Parse a single film from a list item. Supports the modern markup
 * (li.griditem > div.react-component[data-item-slug]) and the legacy
 * markup (li.poster-container > div.film-poster[data-film-slug]).
 *
 * Modern example:
 *   <li class="griditem">
 *     <div class="react-component" data-component-class="LazyPoster"
 *          data-item-name="Tony (2026)" data-item-slug="tony-2026"
 *          data-item-link="/film/tony-2026/" ...>
 *       <div class="poster film-poster"><img class="image" ...></div>
 *     </div>
 *     <p class="poster-viewingdata" data-item-uid="film:1209001">
 *       <span class="rating -micro -darker rated-7">★★★½</span>
 *     </p>
 *   </li>
 */
function parseFilmPoster($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): Film | null {
  // Modern: react-component with data-item-* attributes.
  const comp = el.find('.react-component[data-item-slug]').first();
  if (comp.length > 0) {
    const slug = comp.attr('data-item-slug');
    const fullName = comp.attr('data-item-full-display-name') ?? comp.attr('data-item-name');
    if (slug && fullName) {
      const { title, year } = splitTitleYear(fullName);
      const ratingEl = el.find('.rating').first();
      const rating = parseRating($, ratingEl);
      const likeEl = el.find('.like-link');
      const liked = likeEl.length > 0 && (likeEl.attr('class') ?? '').includes('is-liked');
      const uid = el.find('.poster-viewingdata').attr('data-item-uid') ?? slug;
      // The list page ships an empty poster placeholder; the real poster is
      // only on the film page (og:image). Treat the placeholder as missing so
      // the UI shows the title fallback and enrichment can fetch the real one.
      const img = el.find('img.image').first();
      const src = img.attr('src') ?? img.attr('data-src') ?? undefined;
      const posterUrl =
        src && !isEmptyPoster(src)
          ? src.replace(/-\d+-\d+-\d+-\d+-crop\.jpg/, '-0-500-0-750-crop.jpg')
          : undefined;
      return {
        id: uid,
        slug,
        title,
        year,
        rating,
        genres: [],
        liked,
        poster: posterUrl,
      };
    }
  }

  // Legacy: film-poster with data-film-* attributes (element itself or a
  // descendant, e.g. li.poster-container > div.film-poster).
  const poster = el.is('.film-poster') ? el : el.find('.film-poster').first();
  const slug = poster.attr('data-film-slug');
  const title = poster.attr('data-film-title');
  if (slug && title) {
    const yearRaw = poster.attr('data-film-release-year');
    const year = yearRaw ? parseInt(yearRaw, 10) : null;
    const img = poster.find('img').first();
    const src = img.attr('src') ?? img.attr('data-src') ?? undefined;
    // Letterboxd serves an empty placeholder on list pages; treat it as
    // missing so the real poster is fetched from the film page later.
    const posterUrl =
      src && !isEmptyPoster(src)
        ? src.replace(/-\d+-\d+-\d+-\d+-crop\.jpg/, '-0-500-0-750-crop.jpg')
        : undefined;
    const ratingEl = el.find('.rating').first();
    const rating = parseRating($, ratingEl);
    const likeEl = el.find('.like-link');
    const liked = likeEl.length > 0 && (likeEl.attr('class') ?? '').includes('is-liked');
    return {
      id: poster.attr('data-film-id') ?? slug,
      slug,
      title,
      year: Number.isFinite(year as number) ? year : null,
      rating,
      genres: [],
      liked,
      poster: posterUrl,
    };
  }

  return null;
}

/** Parse a films page. Tries multiple container selectors for resilience. */
function parseFilmsPage(html: string): Film[] {
  const $ = cheerio.load(html);
  const films: Film[] = [];
  const seen = new Set<string>();

  const add = (film: Film | null) => {
    if (film && !seen.has(film.slug)) {
      seen.add(film.slug);
      films.push(film);
    }
  };

  // Modern grid items.
  $('li.griditem').each((_, li) => add(parseFilmPoster($, $(li))));
  // Legacy poster containers (only if the modern selector found nothing).
  if (films.length === 0) {
    $('li.poster-container').each((_, li) => add(parseFilmPoster($, $(li))));
  }
  // Bare film-poster divs (some pages render without the li wrapper).
  if (films.length === 0) {
    $('div.film-poster').each((_, el) => add(parseFilmPoster($, $(el))));
  }
  return films;
}

/**
 * Parse a following page. Handles both `div.person-summary` (current) and
 * `li.person-summary` (legacy), and both `a.name` and `.name a` name links.
 */
function parseFollowingPage(html: string): { id: string; name: string; avatar?: string }[] {
  const $ = cheerio.load(html);
  const people: { id: string; name: string; avatar?: string }[] = [];

  $('div.person-summary, li.person-summary').each((_, el) => {
    const $el = $(el);
    // Modern: <a class="name" href="/user/">; Legacy: <a> inside .name.
    const nameEl = $el.find('a.name').first();
    const legacyNameEl = $el.find('.name a').first();
    const href = nameEl.attr('href') ?? legacyNameEl.attr('href') ?? '';
    const id = href.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!id) return;
    const name = nameEl.text().trim() || legacyNameEl.text().trim() || id;
    const avatarEl = $el.find('a.avatar img').first();
    people.push({ id, name, avatar: avatarEl.attr('src') });
  });

  return people;
}

function parseListsPage(html: string): string[] {
  const $ = cheerio.load(html);
  const lists: string[] = [];
  $('li.list-summary a.list-link').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const slug = href.split('/').filter(Boolean).pop();
    if (slug) lists.push(slug);
  });
  return lists;
}

function parseReviewsPage(html: string): { filmSlug: string; text: string }[] {
  const $ = cheerio.load(html);
  const reviews: { filmSlug: string; text: string }[] = [];
  $('li.film-detail').each((_, li) => {
    const $li = $(li);
    const link = $li.find('.film-title a').first().attr('href') ?? '';
    const slug = link.split('/').filter(Boolean).pop();
    const text = $li.find('.body-text').first().text().trim();
    if (slug && text) reviews.push({ filmSlug: slug, text });
  });
  return reviews;
}

function parseProfilePage(html: string, username: string): { name: string; avatar?: string; bio?: string; private: boolean } {
  const $ = cheerio.load(html);
  const bodyText = $('body').text();
  const isPrivate = /profile is private|this account is private|private profile/i.test(bodyText);

  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() ?? '';
  const name =
    ogTitle
      .replace(/['’]s profile$/i, '')
      .replace(/\s*[|•·–-]\s*Letterboxd.*$/i, '')
      .trim() ||
    $('span.name').first().text().trim() ||
    username;
  const avatar = $('img.avatar').first().attr('src') ?? $('meta[property="og:image"]').attr('content');
  const bio = $('div.bio').first().text().trim() || undefined;

  return { name, avatar, bio, private: isPrivate };
}

function parseFilmPage(html: string, fallback: Film): Film {
  const $ = cheerio.load(html);
  const genres: string[] = [];
  $('a[href^="/films/genre/"]').each((_, a) => {
    const g = $(a).text().trim();
    if (g) genres.push(g);
  });
  // The film title lives in the production masthead. The FIRST <h1> on the
  // page is the site logo ("Letterboxd — Your life in film"), so never use
  // $('h1').first() here. Fall back to og:title (strip the trailing year).
  const mastheadTitle = $('section.production-masthead h1').first().text().trim();
  const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
  const title =
    mastheadTitle || ogTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim() || fallback.title;
  // Year lives in a[href^="/films/year/"] (inside span.releasedate), not
  // necessarily inside small.metadata. Fall back to the year in og:title.
  const yearRaw =
    $('a[href^="/films/year/"]').first().text().trim() ||
    (ogTitle.match(/\((\d{4})\)/) ?? [])[1] ||
    '';
  const year = yearRaw ? parseInt(yearRaw, 10) : fallback.year;
  // The <img class="image"> is an empty placeholder; the real poster is in og:image.
  const img =
    $('meta[property="og:image"]').attr('content') ??
    $('img.image').first().attr('src') ??
    fallback.poster;
  // Never let a lazy-load placeholder become a "real" poster — if og:image
  // is missing and the img is still the empty placeholder, keep the fallback
  // (a real poster from the list page, or undefined → title fallback in UI).
  const poster = img && !isEmptyPoster(img) ? img : fallback.poster;
  // Synopsis + tagline + director + runtime from the film page.
  const synopsis = $('div.truncate').first().text().trim() || fallback.synopsis;
  const tagline = $('h4.tagline').first().text().trim() || fallback.tagline;
  const director = $('a[href*="/director/"]').first().text().trim() || fallback.director;
  const runtimeRaw = $('p.text-link.text-footer').first().text().trim();
  const runtimeMatch = runtimeRaw.match(/(\d+)\s*mins?/i);
  const runtime = runtimeMatch ? `${runtimeMatch[1]} min` : fallback.runtime;
  return {
    ...fallback,
    title,
    year: Number.isFinite(year as number) ? year : fallback.year,
    genres: [...new Set(genres)],
    poster,
    synopsis,
    tagline,
    director,
    runtime,
  };
}

/**
 * Parse the Letterboxd average rating (0.5–5) from a film page's JSON-LD
 * (`aggregateRating.ratingValue`). Kept separate from parseFilmPage so
 * crawling a film page for enrichment never clobbers a friend's *personal*
 * rating on a candidate with the site-wide average.
 */
export function parseFilmPageRating(html: string): number | null {
  const match = html.match(/"aggregateRating"\s*:\s*\{[^{}]*"ratingValue"\s*:\s*([\d.]+)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Fetch a film's detail page by slug and return the enriched Film (real
 * poster via og:image + the Letterboxd average rating). Used by the AI
 * layer to resolve posters/ratings for its "more like this" suggestions.
 * Returns null when the page can't be fetched. Rate-limited as usual.
 */
export async function fetchFilmDetails(slug: string): Promise<Film | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    // Film pages ship the poster in og:image + rating in JSON-LD as
    // server-rendered HTML — no lazy-poster wait needed, and keeping the
    // browser's work minimal reduces stalls on small hosts like Render.
    const html = await getHtml(`${BASE}/film/${slug}/`, `${BASE}/`, {
      waitForPosters: false,
    });
    const fallback: Film = { id: slug, slug, title: slug, year: null, genres: [], rating: null };
    const film = parseFilmPage(html, fallback);
    return { ...film, rating: parseFilmPageRating(html) ?? film.rating };
  } catch (err) {
    console.warn(`[crawler] could not fetch film page for ${slug}:`, (err as Error).message);
    return null;
  }
}

// ─── Pagination helpers ─────────────────────────────────────────────────

function hasNextPage(html: string): boolean {
  const $ = cheerio.load(html);
  const next = $('a.next').first();
  return next.length > 0 && !(next.attr('class') ?? '').includes('disabled');
}

/**
 * Run an async fn over `items` with at most `limit` concurrent executions.
 * The shared sliding-window rate limiter still bounds the aggregate request
 * rate — concurrency just hides per-request latency behind the limiter's
 * spacing, so a friends crawl finishes in wall-clock ~(slots × spacing)
 * instead of adding every network round-trip on top.
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function collectPaginated<T>(
  buildUrl: (page: number) => string,
  parse: (html: string) => T[],
  maxPages: number,
  referer?: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = buildUrl(page);
    let html: string;
    try {
      html = await getHtml(url, referer);
    } catch (err) {
      // A block/challenge mid-list must not throw away the pages we already
      // collected — keep the partial result. Only rethrow when NOTHING was
      // collected so the caller can surface a proper warning.
      if (out.length === 0) throw err;
      console.warn(`[crawler] pagination stopped at page ${page}:`, (err as Error).message);
      break;
    }
    const items = parse(html);
    out.push(...items);
    if (!hasNextPage(html) || items.length === 0) break;
    await sleep(crawlerConfig.delayMs);
  }
  return out;
}

// ─── Public crawler API ─────────────────────────────────────────────────

/**
 * Crawl a user's profile, following list and (optionally) their films.
 * Used for the initial "analyze my taste" step.
 */
export async function crawlUser(username: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? crawlerConfig.maxPages;
  const maxFilms = opts.maxFilms ?? crawlerConfig.maxFilms;
  const maxFriends = opts.maxFriends ?? crawlerConfig.maxFriends;
  // The user's own watchlist is crawled deeper than friends' so the
  // "already watched" exclusion set is as complete as possible.
  const maxUserPages = opts.maxUserPages ?? crawlerConfig.maxUserPages;
  const warnings: string[] = [];

  // 1. Profile — navigated same-origin from the homepage (a cold
  //    sec-fetch-site: none hit on a profile path is a bot signal and gets
  //    blocked; the homepage warm-up + referer primes the session cookie).
  let profileHtml: string;
  try {
    profileHtml = await getHtml(`${BASE}/${username}/`, `${BASE}/`);
  } catch (err) {
    if (err instanceof HttpFetchError && err.status === 404) {
      throw new ProfileNotFoundError(username);
    }
    // Blocked / unavailable — degrade gracefully to manual friend input.
    console.warn('[crawler] profile fetch blocked:', (err as Error).message);
    return {
      user: { id: username, name: username, films: [] },
      friends: [],
      warnings: [
        'Letterboxd blocked automated access to this profile. You can still add friends manually to get recommendations.',
      ],
      blocked: true,
    };
  }
  const profile = parseProfilePage(profileHtml, username);
  if (profile.private) {
    throw new PrivateProfileError(username);
  }

  // 2. Following list
  let following: { id: string; name: string; avatar?: string }[] = [];
  try {
    following = await collectPaginated(
      (p) => `${BASE}/${username}/following/page/${p}/`,
      parseFollowingPage,
      maxPages,
      `${BASE}/${username}/`,
    );
  } catch (err) {
    warnings.push('Could not fetch your following list — add friends manually instead.');
    console.warn('[crawler] following failed:', (err as Error).message);
  }

  // 3. User's own films (for overlap scoring + exclusion). Crawled deeper
  //    than friends' lists so recommendations never include watched films.
  let userFilms: Film[] = [];
  try {
    userFilms = await collectPaginated(
      (p) => `${BASE}/${username}/films/page/${p}/`,
      parseFilmsPage,
      maxUserPages,
      `${BASE}/${username}/`,
    );
  } catch (err) {
    warnings.push('Could not fetch your watched films — overlap scoring will be limited.');
    console.warn('[crawler] user films failed:', (err as Error).message);
  }

  // 3b. User's own lists (for list-overlap scoring).
  let userLists: string[] = [];
  try {
    userLists = await collectPaginated(
      (p) => `${BASE}/${username}/lists/page/${p}/`,
      parseListsPage,
      1,
      `${BASE}/${username}/`,
    );
  } catch {
    // Lists are optional — ignore failures.
  }

  const user: Friend = {
    id: username,
    name: profile.name,
    avatar: profile.avatar,
    bio: profile.bio,
    films: userFilms.slice(0, maxFilms),
    lists: userLists,
  };

  // 4. Friends' films (capped). Crawled in parallel (small concurrency) so
  //    the friends' lists don't serially add up to most of the request
  //    budget on budget hosts like Render — the global rate limiter still
  //    enforces politeness. Skipped in light mode (matchTaste=false):
  //    friends are discovered but their watchlists aren't crawled, so the
  //    analyze step stays fast.
  const friends: Friend[] = [];
  {
    const seen = new Set<string>();
    const targets: { id: string; name: string; avatar?: string }[] = [];
    for (const f of following) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      targets.push(f);
      if (targets.length >= maxFriends) break;
    }
    friends.push(
      ...(await mapLimit(targets, 3, async (f) => {
        if (opts.matchTaste === false) {
          return { id: f.id, name: f.name, avatar: f.avatar, films: [] };
        }
        try {
          const films = await collectPaginated(
            (p) => `${BASE}/${f.id}/films/page/${p}/`,
            parseFilmsPage,
            Math.min(maxPages, 1),
            `${BASE}/${username}/following/`,
          );
          return {
            id: f.id,
            name: f.name,
            avatar: f.avatar,
            films: films.slice(0, maxFilms),
          };
        } catch (err) {
          // Private / blocked friend — keep them but mark unavailable.
          return { id: f.id, name: f.name, avatar: f.avatar, films: [], unavailable: true };
        }
      })),
    );
  }

  return { user, friends, warnings, blocked: false };
}

/**
 * Crawl a single friend's profile + films (used for manual friend input).
 */
export async function crawlFriend(username: string, opts: CrawlOptions = {}): Promise<Friend> {
  const maxPages = opts.maxPages ?? crawlerConfig.maxPages;
  const maxFilms = opts.maxFilms ?? crawlerConfig.maxFilms;

  let profileHtml: string;
  try {
    profileHtml = await getHtml(`${BASE}/${username}/`, `${BASE}/`);
  } catch (err) {
    if (err instanceof HttpFetchError && err.status === 404) {
      throw new ProfileNotFoundError(username);
    }
    throw err;
  }
  const profile = parseProfilePage(profileHtml, username);
  if (profile.private) {
    throw new PrivateProfileError(username);
  }

  const films = await collectPaginated(
    (p) => `${BASE}/${username}/films/page/${p}/`,
    parseFilmsPage,
    maxPages,
    `${BASE}/${username}/`,
  );

  return {
    id: username,
    name: profile.name,
    avatar: profile.avatar,
    bio: profile.bio,
    films: films.slice(0, maxFilms),
  };
}

/**
 * Crawl a friend's films filtered to one or more genres, sorted by their
 * rating (entry-rating). The genre-filtered URL guarantees every returned
 * film belongs to the requested genre(s), so no per-film genre enrichment
 * is needed. Returns up to `maxFilms` films.
 */
export async function crawlFriendGenreFilms(
  username: string,
  genres: string[],
  maxFilms = 20,
): Promise<Film[]> {
  const genrePath = genres.map(genreSlug).join('+');
  const films = await collectPaginated(
    (p) => `${BASE}/${username}/films/genre/${genrePath}/by/entry-rating/page/${p}/`,
    parseFilmsPage,
    1,
    `${BASE}/${username}/`,
  );
  return films.slice(0, maxFilms);
}

/**
 * Enrich a set of films with genre data (and real posters) by visiting
 * their film pages. Fetches films missing genres OR missing/placeholder
 * posters (list pages only ship the empty placeholder, so most films need
 * this), up to `limit`.
 */
export async function enrichFilmsWithGenres(films: Film[], limit = 20): Promise<Film[]> {
  const missing = films
    .filter((f) => f.genres.length === 0 || !f.poster || isEmptyPoster(f.poster))
    .slice(0, limit);
  const bySlug = new Map<string, Film>();
  for (const f of films) bySlug.set(f.slug, f);

  for (const film of missing) {
    try {
      // Film pages carry the real poster in og:image (server-rendered), so
      // skip the lazy-poster wait — it would only hold the browser open and
      // burn RAM on memory-constrained hosts like Render.
      const html = await getHtml(`${BASE}/film/${film.slug}/`, undefined, {
        waitForPosters: false,
      });
      const enriched = parseFilmPage(html, film);
      bySlug.set(film.slug, enriched);
    } catch {
      // Keep the film as-is; genres stay empty.
    }
    await sleep(crawlerConfig.delayMs);
  }
  return films.map((f) => bySlug.get(f.slug) ?? f);
}