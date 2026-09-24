// ─── AI recommendation layer ────────────────────────────────────────────
// Sends candidate movies + context to Google Gemini for one-line reasons
// and "more like this" picks. The model must return a real Letterboxd film
// URL for every suggestion, so the app can resolve a real poster + average
// rating for each suggested film from Letterboxd itself. Falls back to a
// deterministic enhancer when no API key is set or the call fails.

import type { CandidateMovie, TasteMatch, SuggestedFilm } from '@/lib/types';
import { aiConfig } from '@/lib/config';
import { fetchFilmDetails } from '@/lib/crawler/letterboxd';
import { GENRES } from '@/lib/utils/genres';

interface AiEnrichment {
  /** Refined reason (1 sentence). */
  reason: string;
  /** Similar films — each carries a real Letterboxd URL + resolved poster/rating. */
  moreLikeThis: SuggestedFilm[];
}

// ─── Gemini call ────────────────────────────────────────────────────────

interface AiResult {
  content: string | null;
  /** Human-readable reason the call failed, or null on success. */
  error: string | null;
}

const AI_SYSTEM_PROMPT = `You are the film-recommendation writer inside Friendboxd, a Letterboxd-themed app. A user picked friends and a genre/mood; the app crawled those friends' Letterboxd watchlists and ranked candidate films. Your job: write one warm, concise reason per candidate, and suggest look-alike films.

Hard rules:
- You NEVER invent films. Candidates are real because they come from crawled watchlists.
- Every "moreLikeThis" suggestion MUST carry a real Letterboxd film URL, in the exact absolute format https://letterboxd.com/film/<slug>/ (lowercase slug). Only suggest a film when you are confident that IS its real Letterboxd slug — otherwise omit it entirely. Fewer correct picks beat invented ones.
- A "reason" mentions the film by name and connects it to the user's genre/mood. One sentence, no fluff.
- Respond with ONLY a JSON array. No markdown, no text outside the JSON.`;

/** Map a failed Gemini response to a message the user can act on. */
function aiErrorMessage(status: number, body: string): string {
  let code = '';
  let message = '';
  let reason = '';
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: { reason?: string }[];
      };
    };
    code = parsed.error?.status ?? '';
    message = parsed.error?.message ?? '';
    reason = (parsed.error?.details ?? []).map((d) => d.reason ?? '').join(' ') || '';
  } catch {
    code = (body.match(/"status"\s*:\s*"([^"]+)"/) ?? [])[1] ?? '';
    message = (body.match(/"message"\s*:\s*"([^"]+)"/) ?? [])[1] ?? '';
  }
  const blob = `${reason} ${code} ${message}`;
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(blob)) {
    return 'your Gemini API quota is exhausted — add credits or raise the quota in Google AI Studio.';
  }
  if (/API_KEY_INVALID|key not valid|PERMISSION_DENIED|denied/i.test(blob)) {
    return 'Gemini rejected the API key — check GEMINI_API_KEY.';
  }
  if (status === 404 || /NOT_FOUND/i.test(blob)) {
    return 'the configured Gemini model could not be found — check GEMINI_MODEL.';
  }
  if (status === 400 || /INVALID_ARGUMENT/i.test(blob)) {
    return 'Gemini rejected the request (HTTP 400) — the model may not support JSON output mode.';
  }
  if (message) return `Gemini error: ${message}`;
  return `Gemini request failed (HTTP ${status}).`;
}

/** Structured-output schema for the per-candidate "reasons + look-alikes" call. */
const AI_REFINE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      reason: { type: 'STRING' },
      moreLikeThis: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            year: { type: 'INTEGER' },
            letterboxdUrl: { type: 'STRING' },
          },
          required: ['title', 'letterboxdUrl'],
        },
      },
    },
    required: ['reason', 'moreLikeThis'],
  },
} as const;

interface CallGeminiOptions {
  systemPrompt: string;
  prompt: string;
  /** responseSchema — forces the exact JSON shape (Structured Output). */
  responseSchema: Record<string, unknown>;
  maxOutputTokens?: number;
}

async function callGemini({
  systemPrompt,
  prompt,
  responseSchema,
  maxOutputTokens = 16384,
}: CallGeminiOptions): Promise<AiResult> {
  if (!aiConfig.apiKey) return { content: null, error: null };
  const url =
    `${aiConfig.baseUrl}/models/${encodeURIComponent(aiConfig.model)}:generateContent` +
    `?key=${encodeURIComponent(aiConfig.apiKey)}`;

  // Transient overload / quota spikes (429 or 5xx) are retried once after a
  // short pause so a single spike doesn't silently drop the AI layer.
  const attempts = [false, true];
  for (const isRetry of attempts) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            // Thinking models like gemini-3.5-flash otherwise spend most of
            // the output budget on internal reasoning and hit MAX_TOKENS
            // mid-JSON — disable thinking.
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens,
            // Force a clean JSON document — with responseSchema, a shape we
            // can parse blindly. No markdown, ever.
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      });
    } catch (err) {
      if (!isRetry) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      console.warn('[ai] request failed:', (err as Error).message);
      return { content: null, error: `could not reach the Gemini API (${(err as Error).message})` };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Retry once on transient overload/quota (429, 5xx) — not on 4xx.
      if (!isRetry && (res.status === 429 || res.status >= 500)) {
        // Gemini 429 bodies include "Please retry in 12.5s" for per-minute
        // free-tier limits — honour that delay (capped) so the retry lands
        // after the window instead of failing against it again.
        const retryIn = body.match(/retry in ([\d.]+)s/i);
        const delay = Math.min(Math.max(Number(retryIn?.[1]) || 1.5, 1.5), 20);
        console.warn(`[ai] transient error ${res.status}; retrying in ${delay}s…`);
        await new Promise((r) => setTimeout(r, delay * 1000));
        continue;
      }
      console.warn(`[ai] API error ${res.status}:`, body.slice(0, 500));
      return { content: null, error: aiErrorMessage(res.status, body) };
    }

    const data = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    if (!data) return { content: null, error: 'Gemini returned an unparseable response.' };
    const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return { content: text ?? null, error: null };
  }

  return { content: null, error: 'Gemini request failed after retry.' };
}

// ─── Suggested films (AI look-alikes) ───────────────────────────────────

const FILM_URL_RE = /^https?:\/\/letterboxd\.com\/film\/([a-z0-9-]+)\/?$/i;

/**
 * Validate + normalize one AI suggestion entry. Requires a real Letterboxd
 * film URL and a title — anything else (invented film, missing URL) is
 * dropped, because without the URL we can't resolve a poster/rating.
 */
function normalizeSuggested(input: unknown): SuggestedFilm | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : null;
  if (!title) return null;
  const url = typeof o.letterboxdUrl === 'string' ? o.letterboxdUrl.trim() : '';
  const match = url.match(FILM_URL_RE);
  if (!match) return null;
  const slug = match[1].toLowerCase();
  const year = typeof o.year === 'number' && Number.isFinite(o.year) ? o.year : null;
  return {
    title,
    year: year ?? undefined,
    letterboxdUrl: `https://letterboxd.com/film/${slug}/`,
    slug,
  };
}

function normalizeSuggestions(list: unknown): SuggestedFilm[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: SuggestedFilm[] = [];
  for (const item of list) {
    const s = normalizeSuggested(item);
    if (!s) continue;
    const key = s.slug ?? s.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Try to recover a JSON array from a response cut off mid-way (MAX_TOKENS):
 * keep everything through the last complete object, then close the array.
 * Returns null when there isn't at least one complete object.
 */
function salvageJsonArray(cleaned: string): unknown[] | null {
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace <= 0) return null;
  let prefix = cleaned.slice(0, lastBrace + 1).replace(/,\s*$/, '');
  const candidate = prefix.trimEnd().endsWith(']') ? prefix : `${prefix}]`;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Extract + parse a JSON array from the model's reply. Keeps the fence/wrap
 * handling for proxies that don't honour responseMimeType, and salvages the
 * completed items when the output hit the token cap mid-array. Returns null
 * when no usable array can be recovered.
 */
function parseJsonArray(raw: string): unknown[] | null {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    const cleaned = (match?.[0] ?? raw).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (firstErr) {
      parsed = salvageJsonArray(cleaned);
      if (parsed) console.warn('[ai] response was truncated; keeping completed items');
      else throw firstErr;
    }
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Resolve a suggested film's real poster + average rating from Letterboxd. */
async function fetchSuggestionPoster(s: SuggestedFilm): Promise<SuggestedFilm> {
  if (!s.slug) return s;
  const film = await fetchFilmDetails(s.slug);
  if (!film) return s;
  return {
    ...s,
    title: film.title || s.title,
    year: film.year ?? s.year,
    poster: film.poster,
    rating: film.rating ?? null,
  };
}

/** Run an async fn over `items` with at most `limit` concurrent executions. */
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

/**
 * Fetch posters/ratings for suggested films, bounded by
 * `aiConfig.maxSuggestedFilms` (rate-limited by the crawler, so politeness
 * is preserved). Suggestions beyond the cap stay URL-only and are still
 * clickable in the UI.
 */
async function resolveSuggestedPosters(suggestions: SuggestedFilm[]): Promise<SuggestedFilm[]> {
  const capped = suggestions.slice(0, aiConfig.maxSuggestedFilms);
  const resolved = await mapLimit(capped, 3, fetchSuggestionPoster);
  return [...resolved, ...suggestions.slice(capped.length)];
}

// ─── Deterministic fallback ─────────────────────────────────────────────

function deterministicEnrich(candidate: CandidateMovie): AiEnrichment {
  const { influencedBy } = candidate;
  const friends = influencedBy.map((i) => i.friendName);
  const friendPart =
    friends.length === 1
      ? `Your friend ${friends[0]} watched it`
      : friends.length > 0
        ? `Your friends ${friends.join(', ')} all watched it`
        : 'It closely matches your taste';

  const reason = `${friendPart}`;

  return {
    reason,
    moreLikeThis: [], // Deterministic mode can't suggest look-alikes.
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Enrich candidate movies with AI-generated explanations.
 * When the AI is unavailable or fails, falls back to deterministic reasons
 * and reports the failure reason via `aiError` (null when AI succeeded or
 * wasn't attempted with a key).
 */
export async function enrichWithAi(
  candidates: CandidateMovie[],
  selectedMatches: TasteMatch[],
  genreMood: string,
): Promise<{ candidates: CandidateMovie[]; aiUsed: boolean; aiError: string | null }> {
  if (candidates.length === 0) return { candidates, aiUsed: false, aiError: null };

  // Attempt AI call.
  const prompt = buildPrompt(candidates, genreMood);
  const { content: raw, error } = await callGemini({
    systemPrompt: AI_SYSTEM_PROMPT,
    prompt,
    responseSchema: AI_REFINE_SCHEMA,
  });
  type RawAiEntry = { reason?: unknown; moreLikeThis?: unknown };
  let aiParsed: RawAiEntry[] | null = null;
  let aiUsed = false;

  if (raw) {
    const parsed = parseJsonArray(raw);
    if (parsed) {
      aiParsed = parsed as RawAiEntry[];
      aiUsed = true;
    } else {
      console.warn('[ai] response was not a JSON array');
    }
  }

  // Normalize the AI's suggestions (keep only entries with real Letterboxd
  // URLs), fetch posters + ratings (bounded, parallel), then re-attach each
  // candidate's own slice, preserving order.
  const normalized = (aiParsed ?? []).map((entry) => normalizeSuggestions(entry.moreLikeThis));
  const queue = await resolveSuggestedPosters(normalized.flat());

  const enriched = candidates.map((c, i) => {
    const parsed = aiParsed?.[i];
    let ai: AiEnrichment;
    if (parsed) {
      const count = normalized[i]?.length ?? 0;
      ai = {
        reason:
          typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim()
            : deterministicEnrich(c).reason,
        moreLikeThis: queue.splice(0, count),
      };
    } else {
      ai = deterministicEnrich(c);
    }
    return { ...c, ai };
  });

  return { candidates: enriched, aiUsed, aiError: error };
}

// ─── "Suggest more movies" (replaces the old "AI refine") ───────────────

const SUGGEST_MORE_COUNT = 5;

const SUGGEST_MORE_SYSTEM_PROMPT = `You are the film-suggestion engine inside Friendboxd, a Letterboxd-themed app. The user already sees a ranked list of candidate films; your job is to expand the list with NEW films they would enjoy just as much, even if those films were not on their friends' watchlists.

Hard rules:
- NEVER repeat any film from the provided list.
- Never invent films. Only suggest well-known, real films whose Letterboxd slug you are confident about.
- Every suggestion MUST carry a real Letterboxd film URL in the exact absolute format https://letterboxd.com/film/<slug>/ (lowercase slug). Omit a film entirely if you can't provide a real URL — fewer correct picks beat invented ones.
- Respond with ONLY a JSON array. No markdown, no text outside the JSON.`;

/**
 * Ask Gemini for a handful of NEW films similar to the current picks, then
 * resolve real posters/ratings from Letterboxd and return them as ready-made
 * candidate cards (appended to the user's grid). Requires an API key.
 */
export async function suggestMoreFilms(
  candidates: CandidateMovie[],
  genreMood: string,
): Promise<{ movies: CandidateMovie[]; aiUsed: boolean; aiError: string | null }> {
  if (!aiConfig.apiKey) return { movies: [], aiUsed: false, aiError: null };

  const knownSlugs = new Set(candidates.map((c) => c.film.slug));
  const list = candidates
    .slice(0, 12)
    .map(
      (c, i) =>
        `${i + 1}. "${c.film.title}"${c.film.year ? ` (${c.film.year})` : ''}` +
        ` — Genres: ${c.film.genres.join(', ') || 'unknown'}. Score: ${c.score}/100.`,
    )
    .join('\n');

  const prompt = `The user picked the genre/mood "${genreMood}" and currently sees these films:\n\n${list}\n\nSuggest ${SUGGEST_MORE_COUNT} NEW films they would enjoy just as much — same vibe, genre, era or director as the ones above, but NOT any film listed above.\n\nReturn a JSON array with EXACTLY ${SUGGEST_MORE_COUNT} objects, each:\n{\n  "title": "Film Title",\n  "year": 1999,\n  "letterboxdUrl": "https://letterboxd.com/film/exact-slug/"\n}`;

  const { content, error } = await callGemini({
    systemPrompt: SUGGEST_MORE_SYSTEM_PROMPT,
    prompt,
    responseSchema: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          year: { type: 'INTEGER' },
          letterboxdUrl: { type: 'STRING' },
        },
        required: ['title', 'letterboxdUrl'],
      },
    },
  });
  if (error || !content) return { movies: [], aiUsed: false, aiError: error };

  const parsed = parseJsonArray(content);
  if (!parsed) return { movies: [], aiUsed: false, aiError: null };

  const suggestions = normalizeSuggestions(parsed).filter(
    (s) => s.slug && !knownSlugs.has(s.slug),
  );
  if (suggestions.length === 0) return { movies: [], aiUsed: false, aiError: null };

  const resolved = await resolveSuggestedPosters(suggestions);
  const movies: CandidateMovie[] = resolved.map((s) => {
    const rating = s.rating ?? null;
    return {
      // Score derives from the Letterboxd average (0.5–5 → 10–100).
      film: {
        id: s.slug ?? s.title.toLowerCase(),
        slug: s.slug ?? s.title.toLowerCase(),
        title: s.title,
        year: s.year ?? null,
        rating,
        genres: [],
        poster: s.poster,
      },
      score: rating ? Math.max(60, Math.round(rating * 20)) : 75,
      reasons: [],
      influencedBy: [],
      genreRelevance: 1,
    };
  });

  return { movies, aiUsed: true, aiError: null };
}

// ─── Mood → genre classification ───────────────────────────────────────

const MOOD_SYSTEM_PROMPT = `You are the mood → genre classifier inside Friendboxd, a Letterboxd-themed app. The user described a vibe in their own words. Classify it into exactly ONE genre from this list: ${GENRES.join(', ')}. Pick the single most fitting genre. If nothing clearly fits, choose "Drama". Respond with ONLY a JSON object: { "genre": "Sci-Fi" }. No markdown, no explanation.`;

/**
 * Ask Gemini to map a free-text mood description to one of the app's
 * Letterboxd genres. Returns `genre: null` when no key is configured or the
 * call fails, so the caller can fall back to local keyword matching.
 */
export async function classifyMood(
  text: string,
): Promise<{ genre: string | null; aiError: string | null }> {
  if (!aiConfig.apiKey) return { genre: null, aiError: null };
  const { content, error } = await callGemini({
    systemPrompt: MOOD_SYSTEM_PROMPT,
    prompt: text.trim().slice(0, 120),
    responseSchema: {
      type: 'OBJECT',
      properties: { genre: { type: 'STRING' } },
      required: ['genre'],
    },
    maxOutputTokens: 256,
  });
  if (error || !content) return { genre: null, aiError: error };

  try {
    const parsed = JSON.parse(content) as { genre?: unknown };
    const genre = typeof parsed.genre === 'string' ? parsed.genre.trim() : '';
    // Only accept a genre from the canonical list, so the crawl + scorer
    // always receive something they understand.
    if (!(GENRES as readonly string[]).includes(genre)) return { genre: null, aiError: null };
    return { genre, aiError: null };
  } catch {
    return { genre: null, aiError: null };
  }
}

function buildPrompt(candidates: CandidateMovie[], genreMood: string): string {
  const filmList = candidates
    .map(
      (c, i) =>
        `${i + 1}. "${c.film.title}"${c.film.year ? ` (${c.film.year})` : ''}` +
        ` — Genres: ${c.film.genres.join(', ') || 'unknown'}.` +
        ` Friend rating: ${c.influencedBy[0]?.friendRating ?? 'unrated'}.` +
        ` Score: ${c.score}/100.`,
    )
    .join('\n');

  return `The user picked the genre/mood "${genreMood}". Below are ${candidates.length} candidate films, already ranked by the app's scorer, taken from their friends' Letterboxd watchlists:

${filmList}

Return a JSON array with EXACTLY ${candidates.length} objects, one per candidate, in the same order. Each object is:
{
  "reason": "One concise, warm sentence about why this film suits the user (name the film, tie it to the genre/mood).",
  "moreLikeThis": [
    { "title": "Film Title", "year": 1999, "letterboxdUrl": "https://letterboxd.com/film/exact-slug/" }
  ]
}

Rules for "moreLikeThis":
- 1 to 3 films per candidate, genuinely similar (vibe, director, era, genre, and in the same letterboxd spirit).
- Every entry MUST include "letterboxdUrl" in the exact format https://letterboxd.com/film/<slug>/ — the film's REAL Letterboxd slug.
- Never invent a film or guess a slug you are not sure about; omit the film entirely if you can't provide a real URL.
- Do not suggest the candidate film itself.`;
}