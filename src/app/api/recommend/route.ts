import { NextRequest, NextResponse } from 'next/server';
import { recommendMovies } from '@/lib/engine';
import { validateUsername, validateGenre } from '@/lib/utils/validation';
import { MAX_SELECTED_FRIENDS } from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/recommend
 * Body: { username, friendIds: string[], genre: string, weights?: Record<string, number> }
 */
export async function POST(req: NextRequest) {
  let body: {
    username?: string;
    friendIds?: string[];
    genre?: string;
    weights?: Record<string, number>;
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

  try {
    const result = await recommendMovies(
      userCheck.value,
      friendIds,
      genreCheck.value,
      weights,
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/recommend]', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Could not generate recommendations right now.' },
      { status: 500 },
    );
  }
}