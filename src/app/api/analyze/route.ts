import { NextRequest, NextResponse } from 'next/server';
import { analyzeTaste } from '@/lib/engine';
import { validateUsername } from '@/lib/utils/validation';
import { ProfileNotFoundError, PrivateProfileError } from '@/lib/crawler/letterboxd';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { username?: string; matchTaste?: boolean };
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
    const result = await analyzeTaste(check.value, { matchTaste: body.matchTaste });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof PrivateProfileError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/analyze]', err);
    return NextResponse.json(
      { error: 'Could not analyze this profile right now. Please try again in a moment.' },
      { status: 500 },
    );
  }
}