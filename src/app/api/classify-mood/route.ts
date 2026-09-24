import { NextRequest, NextResponse } from 'next/server';
import { classifyMood } from '@/lib/ai/recommender';
import { aiConfig } from '@/lib/config';

export const runtime = 'nodejs';
// Leave room for Gemini free-tier rate-limit retries (up to ~60s of waits
// across the recoverable per-minute bucket) on top of the call itself.
export const maxDuration = 120;

/**
 * POST /api/classify-mood
 * Body: { description: string }
 *
 * Maps a free-text mood/vibe description to one of the app's Letterboxd
 * genres using Gemini. Returns { genre, aiError } with HTTP 200 even when
 * classification failed (genre: null) so the client silently falls back to
 * local keyword matching.
 */
export async function POST(req: NextRequest) {
  let body: { description?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return NextResponse.json({ error: 'No mood description provided.' }, { status: 400 });
  }
  if (description.length > 120) {
    return NextResponse.json({ error: 'Keep it under 120 characters.' }, { status: 400 });
  }

  if (!aiConfig.apiKey) {
    return NextResponse.json(
      { error: 'Add a Gemini API key to enable AI mood matching.' },
      { status: 400 },
    );
  }

  const { genre, aiError } = await classifyMood(description);
  if (aiError) console.warn('[api/classify-mood] AI unavailable:', aiError);
  return NextResponse.json({ genre, aiError });
}