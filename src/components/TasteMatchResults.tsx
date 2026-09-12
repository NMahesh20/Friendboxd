'use client';

import type { TasteMatch } from '@/lib/types';

const SIGNALS: {
  key: keyof TasteMatch['breakdown'];
  label: string;
  hint: string;
}[] = [
  { key: 'ratingOverlap', label: 'Rating overlap', hint: 'How often you rate films the same' },
  { key: 'genreOverlap', label: 'Genre overlap', hint: 'Shared genre preferences' },
  { key: 'listOverlap', label: 'List overlap', hint: 'Shared public lists' },
  { key: 'reviewConsistency', label: 'Review consistency', hint: 'Similar review habits' },
  { key: 'recencyWeight', label: 'Recency', hint: 'Recent shared activity' },
];

export function TasteMatchResults({ match }: { match: TasteMatch }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-zinc-300">{match.explanation}</p>

      <div className="space-y-3">
        {SIGNALS.map((s) => {
          const value = match.breakdown[s.key];
          return (
            <div key={s.key}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs font-medium text-zinc-300">{s.label}</span>
                <span className="text-xs text-zinc-500">{Math.round(value * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-700/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft transition-all duration-700"
                  style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
                />
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-600">{s.hint}</p>
            </div>
          );
        })}
      </div>

      {match.sharedFilms.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Films you both rated
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {match.sharedFilms.slice(0, 8).map((f) => (
              <span
                key={`${f.title}-${f.year}`}
                className="chip"
                title={`You: ${f.userRating}★ · ${match.friendName}: ${f.friendRating}★`}
              >
                {f.title}
                {f.year ? ` (${f.year})` : ''}
              </span>
            ))}
            {match.sharedFilms.length > 8 && (
              <span className="chip">+{match.sharedFilms.length - 8} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}