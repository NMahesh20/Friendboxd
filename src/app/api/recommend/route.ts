import { NextRequest, NextResponse } from 'next/server';
import { recommendMovies } from '@/lib/engine';
import { validateUsername, validateGenre } from '@/lib/utils/validation';
import { MAX_SELECTED_FRIENDS } from '@/lib/config';
import { completeJob, createJob, failJob } from '@/lib/jobs';
import type { RecommendationResult } from '@/lib/types';

export const runtime = 'nodejs';
// Input validation only — the crawl runs detached behind a job id (see
// /api/analyze). The response is immediate, so a mobile connection is never
// held idle long enough to be dropped mid-crawl.
export const maxDuration = 15;

/**
 * POST /api/recommend
 * Body: { username, friendIds: string[], genre: string, weights?: Record<string, number> }
 * Returns 202 { jobId } immediately; poll GET /api/jobs/:id for the result.
 */
export async function POST(req: NextRequest) {
  let body: {
    username?: string;
    friendIds?: string[];
    genre?: string;
    weights?: Record<string, number>;
    requestId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const userCheck = validateUsername(body.username);
  if (!userCheck.ok || !userCheck.value) {
    return NextResponse.json({ error: userCheck.error }, { status: 400 });
  }

  const genreCheck = validateGenre(body.genre);
  if (!genreCheck.ok || !genreCheck.value) {
    return NextResponse.json({ error: genreCheck.error }, { status: 400 });
  }

  const friendIds = Array.isArray(body.friendIds)
    ? [...new Set(body.friendIds.map((f) => f.trim().toLowerCase()).filter(Boolean))]
    : [];

  if (friendIds.length === 0) {
    return NextResponse.json(
      { error: 'Please select at least one friend to tune your recommendations.' },
      { status: 400 },
    );
  }
  if (friendIds.length > MAX_SELECTED_FRIENDS) {
    return NextResponse.json(
      { error: `You can select up to ${MAX_SELECTED_FRIENDS} friends.` },
      { status: 400 },
    );
  }

  // Sanitize weights: only keep valid 0–100 numbers for selected friends.
  const weights: Record<string, number> = {};
  if (body.weights && typeof body.weights === 'object') {
    for (const id of friendIds) {
      const raw = body.weights[id];
      const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 50;
      weights[id] = Math.min(100, Math.max(0, Math.round(n)));
    }
  }

  // Keyed on the caller's requestId so a retried POST reattaches to the
  // crawl already running instead of starting a duplicate. Note the key is
  // per-run, not per-genre: "Regenerate" sends a fresh id and really does
  // re-crawl.
  const { jobId, created } = createJob<RecommendationResult>(
    typeof body.requestId === 'string' ? body.requestId : undefined,
  );
  const username = userCheck.value;
  const genre = genreCheck.value;

  // Detached on purpose — the response is already on its way. A dedupe hit
  // means this crawl is already running, so leave it alone.
  if (created) {
    void (async () => {
      try {
        completeJob(jobId, await recommendMovies(username, friendIds, genre, weights));
      } catch (err) {
        console.error('[api/recommend]', err);
        failJob(jobId, (err as Error).message || 'Could not generate recommendations right now.');
      }
    })();
  }

  return NextResponse.json({ jobId }, { status: 202 });
}
