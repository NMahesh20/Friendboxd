import { NextRequest, NextResponse } from 'next/server';
import { fetchManualFriend } from '@/lib/engine';
import { validateUsername } from '@/lib/utils/validation';
import { ProfileNotFoundError, PrivateProfileError } from '@/lib/crawler/letterboxd';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/friends
 * Validates + crawls a manually added friend's profile.
 */
export async function POST(req: NextRequest) {
  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const check = validateUsername(body.username);
  if (!check.ok || !check.value) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  try {
    const friend = await fetchManualFriend(check.value);
    return NextResponse.json({ friend });
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof PrivateProfileError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/friends]', err);
    return NextResponse.json(
      { error: 'Could not fetch that friend right now. Please try again.' },
      { status: 500 },
    );
  }
}