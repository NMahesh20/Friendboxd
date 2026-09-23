// ─── AI recommendation layer ────────────────────────────────────────────
// Sends candidate movies + context to an OpenAI-compatible API for
// ranking refinement, short reasons, and conversational explanations.
// Falls back to a deterministic enhancer when no API key is set.

import type { CandidateMovie, TasteMatch, Influence } from '@/lib/types';
import { aiConfig } from '@/lib/config';
import { truncate } from '@/lib/utils/format';

interface AiEnrichment {
  /** Refined reason (1 sentence). */
  reason: string;
  /** Similar film titles. */
  moreLikeThis: string[];
}

// ─── OpenAI call ────────────────────────────────────────────────────────

interface OpenAiResult {
  content: string | null;
  /** Human-readable reason the call failed, or null on success. */
  error: string | null;
}

/** Map a failed OpenAI response to a message the user can act on. */
function apiErrorMessage(status: number, body: string): string {
  const code = (body.match(/"code"\s*:\s*"([^"]+)"/) ?? [])[1] ?? '';
  const type = (body.match(/"type"\s*:\s*"([^"]+)"/) ?? [])[1] ?? '';
  const message = (body.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? '';
  if (status === 429 || /credit|quota|insufficient_quota/i.test(`${code} ${type}`)) {
    return 'your OpenAI account has no credits left — add credits at platform.openai.com/settings/organization/billing.';
  }
  if (status === 401 || /invalid_api_key|auth/i.test(`${code} ${type}`)) {
    return 'OpenAI rejected the API key (invalid_api_key) — check OPENAI_API_KEY.';
  }
  if (status === 404 || /model_not_found/i.test(`${code} ${type}`)) {
    return 'the configured OpenAI model is not available to this key — check OPENAI_MODEL or model access.';
  }
  if (status === 403) {
    return `OpenAI denied the request (HTTP 403) — the key may be missing "Chat Completions: write" permission.`;
  }
  if (message) return `OpenAI error: ${message}`;
  return `OpenAI request failed (HTTP ${status}).`;
}

async function callOpenAi(prompt: string): Promise<OpenAiResult> {
  if (!aiConfig.apiKey) return { content: null, error: null };
  let res: Response;
  try {
    res = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: 0.7,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are a friendly, knowledgeable film-recommendation assistant inside a Letterboxd-inspired app called Friendboxd.

Rules:
- You do NOT invent films. You only comment on films provided to you.
- Keep explanations concise and warm.
- Return ONLY a JSON array matching the schema provided. No extra text.`,
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
  } catch (err) {
    console.warn('[ai] request failed:', (err as Error).message);
    return { content: null, error: `could not reach the OpenAI API (${(err as Error).message})` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[ai] API error ${res.status}:`, body.slice(0, 500));
    return { content: null, error: apiErrorMessage(res.status, body) };
  }
  const data = await res.json().catch(() => null);
  if (!data) return { content: null, error: 'OpenAI returned an unparseable response.' };
  return { content: data.choices?.[0]?.message?.content ?? null, error: null };
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
  const { content: raw, error } = await callOpenAi(prompt);
  let aiParsed: AiEnrichment[] | null = null;
  let aiUsed = false;

  if (raw) {
    try {
      // Extract the JSON array from the response — it may be wrapped in
      // ```json fences, or have explanatory text before/after it.
      const match = raw.match(/\[[\s\S]*\]/);
      const cleaned = (match?.[0] ?? raw).trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        aiParsed = parsed;
        aiUsed = true;
      } else {
        console.warn('[ai] response was not a JSON array');
      }
    } catch (err) {
      console.warn('[ai] could not parse response as JSON:', (err as Error).message);
    }
  }

  const enriched = candidates.map((c, i) => {
    const ai = aiParsed?.[i] ?? deterministicEnrich(c);
    return { ...c, ai };
  });

  return { candidates: enriched, aiUsed, aiError: error };
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

  return `The user wants movies matching the genre/mood: "${genreMood}".

Here are ${candidates.length} candidate films ranked by algorithmic score:

${filmList}

Return a JSON array (same length as the list above) where each element has:
{
  "reason": "One concise sentence explaining why this is recommended",
  "moreLikeThis": ["Film Title A", "Film Title B"]
}

Return ONLY the JSON array.`;
}