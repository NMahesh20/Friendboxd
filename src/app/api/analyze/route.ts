import { NextRequest, NextResponse } from 'next/server';
import { analyzeTaste } from '@/lib/engine';
import { validateUsername } from '@/lib/utils/validation';
import { ProfileNotFoundError, PrivateProfileError } from '@/lib/crawler/letterboxd';
import { completeJob, createJob, failJob } from '@/lib/jobs';
import type { AnalyzeResult } from '@/lib/types';

export const runtime = 'nodejs';
// This handler only validates input and hands back a job id — the crawl
// itself runs detached, so the request itself finishes in milliseconds and
// is never exposed to a dropped mobile connection. The crawl is kept awake
// by keepalive.ts for as long as it runs.
export const maxDuration = 15;

/**
 * POST /api/analyze
 * Body: { username, matchTaste?: boolean }
 * Returns 202 { jobId } immediately; poll GET /api/jobs/:id for the result.
 */
export async function POST(req: NextRequest) {
  let body: { username?: string; matchTaste?: boolean; requestId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const check = validateUsername(body.username);
  if (!check.ok || !check.value) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  // Keyed on the caller's requestId so a retried POST reattaches to the
  // crawl already running instead of starting a duplicate.
  const { jobId, created } = createJob<AnalyzeResult>(
    typeof body.requestId === 'string' ? body.requestId : undefined,
  );
  const username = check.value;
  const matchTaste = Boolean(body.matchTaste);

  // Detached on purpose — the response is already on its way. A dedupe hit
  // means this crawl is already running, so leave it alone.
  if (created) {
    void (async () => {
      try {
        completeJob(jobId, await analyzeTaste(username, { matchTaste }));
      } catch (err) {
        if (err instanceof ProfileNotFoundError) {
          failJob(jobId, err.message, 404);
          return;
        }
        if (err instanceof PrivateProfileError) {
          failJob(jobId, err.message, 403);
          return;
        }
        console.error('[api/analyze]', err);
        failJob(
          jobId,
          'Could not analyze this profile right now. Please try again in a moment.',
          500,
        );
      }
    })();
  }

  return NextResponse.json({ jobId }, { status: 202 });
}
