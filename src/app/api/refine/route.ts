import { NextRequest, NextResponse } from 'next/server';
import { enrichWithAi } from '@/lib/ai/recommender';
import { aiConfig } from '@/lib/config';
import type { CandidateMovie } from '@/lib/types';

export const runtime = 'nodejs';
// Leave room for Gemini free-tier rate-limit retries (up to ~60s of waits
// across the recoverable per-minute bucket) plus poster resolution.
export const maxDuration = 120;

/**
 * POST /api/refine
 * Body: { candidates: CandidateMovie[], genre: string }
 *
 * Re-runs the AI layer on the current picks to refresh AI-generated reasons
 * and "more like this" suggestions. Requires a Gemini API key — the client
 * disables the button without one, and we guard here too.
 */
export async function POST(req: NextRequest) {
  let body: { candidates?: CandidateMovie[]; genre?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return NextResponse.json({ error: 'No candidates to refine.' }, { status: 400 });
  }

  if (!aiConfig.apiKey) {
    return NextResponse.json(
      { error: 'Add a Gemini API key to enable AI refine.' },
      { status: 400 },
    );
  }

  const genre = typeof body.genre === 'string' ? body.genre : '';

  try {
    const { candidates, aiUsed, aiError } = await enrichWithAi(body.candidates, [], genre);
    // Detailed failure reason stays in the server log; the dashboard shows
    // a generic message ("AI refine is temporarily unavailable…").
    if (aiError) console.warn('[api/refine] AI unavailable:', aiError);
    return NextResponse.json({ candidates, aiUsed, aiError });
  } catch (err) {
    console.error('[api/refine]', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Could not refine picks right now.' },
      { status: 500 },
    );
  }
}