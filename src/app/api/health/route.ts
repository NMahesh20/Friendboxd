import { NextResponse } from 'next/server';
import { aiConfig, crawlerConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'friendboxd',
    ai: aiConfig.apiKey ? 'configured' : 'fallback',
    crawlerMode: crawlerConfig.mode,
    time: new Date().toISOString(),
  });
}