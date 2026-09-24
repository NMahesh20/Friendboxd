import { NextRequest, NextResponse } from 'next/server';
import { suggestMoreFilms } from '@/lib/ai/recommender';
import { aiConfig } from '@/lib/config';
import type { CandidateMovie } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/suggest-more
 * Body: { candidates: CandidateMovie[], genre: string }
 *
 * Asks Gemini for a few NEW films similar to the current picks, resolves
 * real posters/ratings from Letterboxd, and returns them ready to append
 * to the results grid. Requires a Gemini API key (button is hidden without
 * one, and we guard here too).
 */
export async function POST(req: NextRequest) {
  let body: { candidates?: CandidateMovie[]; genre?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return NextResponse.json({ error: 'No candidates to base suggestions on.' }, { status: 400 });
  }

  if (!aiConfig.apiKey) {
    return NextResponse.json(
      { error: 'Add a Gemini API key to enable AI suggestions.' },
      { status: 400 },
    );
  }

  const genre = typeof body.genre === 'string' ? body.genre : '';

  try {
    const { movies, aiUsed, aiError } = await suggestMoreFilms(body.candidates, genre);
    // Detailed failure reason stays in the server log; the dashboard shows
    // a generic message.
    if (aiError) console.warn('[api/suggest-more] AI unavailable:', aiError);
    return NextResponse.json({ movies, aiUsed, aiError });
  } catch (err) {
    console.error('[api/suggest-more]', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Could not suggest more movies right now.' },
      { status: 500 },
    );
  }
}