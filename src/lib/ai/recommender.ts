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

async function callOpenAi(prompt: string): Promise<string | null> {
  if (!aiConfig.apiKey) return null;
  try {
    const res = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
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
    if (!res.ok) {
      console.warn('[ai] API returned status', res.status);
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.warn('[ai] request failed:', (err as Error).message);
    return null;
  }
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
 * When the AI is unavailable, falls back to deterministic reasons.
 */
export async function enrichWithAi(
  candidates: CandidateMovie[],
  selectedMatches: TasteMatch[],
  genreMood: string,
): Promise<{ candidates: CandidateMovie[]; aiUsed: boolean }> {
  if (candidates.length === 0) return { candidates, aiUsed: false };

  // Attempt AI call.
  const prompt = buildPrompt(candidates, genreMood);
  const raw = await callOpenAi(prompt);
  let aiParsed: AiEnrichment[] | null = null;
  let aiUsed = false;

  if (raw) {
    try {
      // Extract JSON array from the response (may be wrapped in ```json fences).
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        aiParsed = parsed;
        aiUsed = true;
      }
    } catch {
      console.warn('[ai] could not parse response as JSON');
    }
  }

  const enriched = candidates.map((c, i) => {
    const ai = aiParsed?.[i] ?? deterministicEnrich(c);
    return { ...c, ai };
  });

  return { candidates: enriched, aiUsed };
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