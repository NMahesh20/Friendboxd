import { NextRequest, NextResponse } from 'next/server';
import { fetchManualFriend } from '@/lib/engine';
import { validateUsername } from '@/lib/utils/validation';
import { ProfileNotFoundError, PrivateProfileError } from '@/lib/crawler/letterboxd';
import { completeJob, createJob, failJob } from '@/lib/jobs';
import type { Friend } from '@/lib/types';

export const runtime = 'nodejs';
// Input validation only — the crawl runs detached behind a job id so the
// mobile connection is never held idle (see /api/analyze).
export const maxDuration = 15;

/**
 * POST /api/friends
 * Validates + crawls a manually added friend's profile.
 * Returns 202 { jobId }; poll GET /api/jobs/:id for { friend }.
 */
export async function POST(req: NextRequest) {
  let body: { username?: string; requestId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const check = validateUsername(body.username);
  if (!check.ok || !check.value) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const { jobId, created } = createJob<{ friend: Friend }>(
    typeof body.requestId === 'string' ? body.requestId : undefined,
  );
  const username = check.value;

  if (created) {
    void (async () => {
      try {
        completeJob(jobId, { friend: await fetchManualFriend(username) });
      } catch (err) {
        if (err instanceof ProfileNotFoundError) {
          failJob(jobId, err.message, 404);
          return;
        }
        if (err instanceof PrivateProfileError) {
          failJob(jobId, err.message, 403);
          return;
        }
        console.error('[api/friends]', err);
        failJob(jobId, 'Could not fetch that friend right now. Please try again.', 500);
      }
    })();
  }

  return NextResponse.json({ jobId }, { status: 202 });
}
