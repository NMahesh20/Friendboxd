'use client';

import { Spinner } from '@/components/ui/Spinner';
import { useCrawlStatus } from '@/lib/client/useCrawlStatus';

export function Analyzing({ username }: { username: string }) {
  // Live, server-reported crawl phase (safe whitelisted one-liner). The
  // component only exists while the analyze request is in flight, so
  // polling runs for exactly that window.
  const { line, user, film } = useCrawlStatus(true, 'Finding your profile…');
  const context = [user ? `@${user}` : null, film || null].filter(Boolean).join(' · ');

  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <div className="relative mb-8 flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-accent/40 animate-pulse-ring" />
        <span className="absolute inset-0 rounded-full border border-accent/30 animate-pulse-ring [animation-delay:0.6s]" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent/15">
          <Spinner size={28} className="text-accent" />
        </div>
      </div>

      <h2 className="font-display text-2xl font-semibold text-white">
        Analyzing <span className="accent-gradient">@{username}</span>
      </h2>
      <p className="mt-3 h-5 text-sm text-zinc-400 transition-all animate-fade-in">{line}</p>
      {context && (
        <p className="mt-1 text-xs text-zinc-500 transition-all animate-fade-in">{context}</p>
      )}
    </section>
  );
}