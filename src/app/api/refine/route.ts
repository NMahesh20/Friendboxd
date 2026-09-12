import { NextRequest, NextResponse } from 'next/server';
import { enrichWithAi } from '@/lib/ai/recommender';
import { aiConfig } from '@/lib/config';
import type { CandidateMovie } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/refine
 * Body: { candidates: CandidateMovie[], genre: string }
 *
 * Re-runs the AI layer on the current picks to refresh AI-generated reasons
 * and "more like this" suggestions. Requires an OpenAI API key — the client
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
      { error: 'Add an OpenAI API key to enable AI refine.' },
      { status: 400 },
    );
  }

  const genre = typeof body.genre === 'string' ? body.genre : '';

  try {
    const { candidates, aiUsed } = await enrichWithAi(body.candidates, [], genre);
    return NextResponse.json({ candidates, aiUsed });
  } catch (err) {
    console.error('[api/refine]', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Could not refine picks right now.' },
      { status: 500 },
    );
  }
}