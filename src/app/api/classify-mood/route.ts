import { NextRequest, NextResponse } from 'next/server';
import { classifyMood } from '@/lib/ai/recommender';
import { aiConfig } from '@/lib/config';
import { completeJob, createJob } from '@/lib/jobs';

export const runtime = 'nodejs';
// Input validation only — the AI call runs detached behind a job id so the
// client polls short requests instead of holding one open (see /api/analyze).
export const maxDuration = 15;

/**
 * POST /api/classify-mood
 * Body: { description: string, requestId?: string }
 *
 * Maps a free-text mood/vibe description to one of the app's Letterboxd
 * genres using Gemini. A failed classification still *succeeds* with
 * { genre: null, aiError } so the client silently falls back to local keyword
 * matching — a mood description must never block step 3.
 *
 * Returns 202 { jobId }; poll GET /api/jobs/:id for the result.
 */
export async function POST(req: NextRequest) {
  let body: { description?: unknown; requestId?: string };
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

  const { jobId, created } = createJob<{ genre: string | null; aiError?: string | null }>(
    typeof body.requestId === 'string' ? body.requestId : undefined,
  );

  if (created) {
    void (async () => {
      try {
        const { genre, aiError } = await classifyMood(description);
        if (aiError) console.warn('[api/classify-mood] AI unavailable:', aiError);
        completeJob(jobId, { genre, aiError });
      } catch (err) {
        // Never fail the job for this route — the caller falls back to local
        // keyword matching, which is better than surfacing an error.
        console.warn('[api/classify-mood]', err);
        completeJob(jobId, { genre: null, aiError: (err as Error).message });
      }
    })();
  }

  return NextResponse.json({ jobId }, { status: 202 });
}
