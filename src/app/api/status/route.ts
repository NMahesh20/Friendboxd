import { NextResponse } from 'next/server';
import { getCrawlStatus } from '@/lib/crawl-status';

export const runtime = 'nodejs';

/**
 * GET /api/status
 * Current crawl phase as a safe, whitelisted one-liner for the loading UI.
 * Never contains usernames, URLs, counts or error text.
 */
export async function GET() {
  return NextResponse.json(getCrawlStatus());
}