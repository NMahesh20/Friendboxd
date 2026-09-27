import { NextRequest, NextResponse } from 'next/server';
import { suggestMoreFilms } from '@/lib/ai/recommender';
import { aiConfig } from '@/lib/config';
import { completeJob, createJob, failJob } from '@/lib/jobs';
import type { CandidateMovie } from '@/lib/types';

export const runtime = 'nodejs';
// Input validation only — the AI work (which can wait out Gemini's free-tier
// rate-limit retries) runs detached behind a job id, so the client polls
// short requests instead of holding one open for a minute.
export const maxDuration = 15;

/**
 * POST /api/suggest-more
 * Body: { candidates: CandidateMovie[], genre: string, requestId?: string }
 *
 * Asks Gemini for a few NEW films similar to the current picks, resolves
 * real posters/ratings from Letterboxd, and returns them ready to append
 * to the results grid. Requires a Gemini API key (button is hidden without
 * one, and we guard here too).
 *
 * Returns 202 { jobId }; poll GET /api/jobs/:id for the result.
 */
export async function POST(req: NextRequest) {
  let body: { candidates?: CandidateMovie[]; genre?: string; requestId?: string };
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
  const candidates = body.candidates;
  const { jobId, created } = createJob<{
    movies: CandidateMovie[];
    aiUsed: boolean;
    aiError?: string | null;
  }>(typeof body.requestId === 'string' ? body.requestId : undefined);

  if (created) {
    void (async () => {
      try {
        const { movies, aiUsed, aiError } = await suggestMoreFilms(candidates, genre);
        // Detailed failure reason stays in the server log; the dashboard shows
        // a generic message.
        if (aiError) console.warn('[api/suggest-more] AI unavailable:', aiError);
        completeJob(jobId, { movies, aiUsed, aiError });
      } catch (err) {
        console.error('[api/suggest-more]', err);
        failJob(jobId, (err as Error).message || 'Could not suggest more movies right now.');
      }
    })();
  }

  return NextResponse.json({ jobId }, { status: 202 });
}
