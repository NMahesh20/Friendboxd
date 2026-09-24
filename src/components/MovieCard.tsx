'use client';

import type { CandidateMovie } from '@/lib/types';
import { stars } from '@/lib/utils/format';

export function MovieCard({
  movie,
  index,
  onOpen,
}: {
  movie: CandidateMovie;
  index: number;
  onOpen: (movie: CandidateMovie) => void;
}) {
  const { film, score, influencedBy } = movie;
  const topFriend = influencedBy[0];

  return (
    <button
      type="button"
      onClick={() => onOpen(movie)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-base-850 text-left shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-white/25 hover:shadow-glow animate-fade-up"
      style={{ animationDelay: `${index * 60}ms` }}
      aria-label={`Open details for ${film.title}`}
    >
      {/* Poster */}
      <div className="poster-aspect relative w-full overflow-hidden bg-base-800">
        {film.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={film.poster}
            alt={`${film.title} poster`}
            // Eager + async: posters come from a slow crawl, so lazy loading
            // here just delays images that should already be visible.
            loading="eager"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-base-700 to-base-900 p-4">
            <span className="text-center font-display text-lg font-semibold text-zinc-300">
              {film.title}
            </span>
          </div>
        )}

        {/* Score badge */}
        <div className="absolute left-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-xs font-bold text-white backdrop-blur-sm">
          {score}
        </div>

        {/* Rating */}
        {film.rating != null && (
          <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-gold backdrop-blur-sm">
            {stars(film.rating)}
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="text-xs font-medium text-white">View details →</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <h3 className="line-clamp-1 font-display text-base font-semibold text-white">
            {film.title}
          </h3>
          <p className="text-xs text-zinc-500">
            {film.year ?? '—'}
            {film.genres.length > 0 && ` · ${film.genres.slice(0, 3).join(', ')}`}
          </p>
        </div>

        {/* Influenced by */}
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          {topFriend && (
            <>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-[9px] font-bold text-accent-soft">
                {topFriend.friendName.charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-[11px] text-zinc-500">
                via {topFriend.friendName}
                {influencedBy.length > 1 && ` +${influencedBy.length - 1}`}
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}