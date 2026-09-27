import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';

export const runtime = 'nodejs';
// Job state only exists in this process's memory — never prerender or cache.
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/:id
 * Poll a long-running crawl. Always a short, cheap round-trip so the
 * connection is never idle long enough for a mobile network to drop it.
 *
 * 200 { state: 'pending' }
 * 200 { state: 'done', result }
 * 200 { state: 'error', error, status }
 * 404 job unknown or expired — the client should start the job again.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);

  if (!job) {
    return NextResponse.json(
      { error: 'That request expired before it finished. Please try again.' },
      { status: 404 },
    );
  }

  if (job.state === 'pending') {
    return NextResponse.json({ state: 'pending' });
  }

  if (job.state === 'error') {
    return NextResponse.json({
      state: 'error',
      error: job.error ?? 'Something went wrong.',
      status: job.errorStatus ?? 500,
    });
  }

  return NextResponse.json({ state: 'done', result: job.result });
}
