'use client';

import type { CandidateMovie } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';
import { TasteMeter } from '@/components/ui/TasteMeter';
import { stars } from '@/lib/utils/format';

export function MovieModal({
  movie,
  onClose,
  onMoreLikeThis,
}: {
  movie: CandidateMovie | null;
  onClose: () => void;
  onMoreLikeThis: (movie: CandidateMovie) => void;
}) {
  if (!movie) return null;
  const { film, influencedBy, score, reasons } = movie;

  return (
    <Modal open={!!movie} onClose={onClose} labelledBy="movie-modal-title">
      <div className="flex flex-col sm:flex-row">
        {/* Poster */}
        <div className="poster-aspect relative w-full shrink-0 overflow-hidden sm:w-56 sm:rounded-l-3xl">
          {film.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={film.poster}
              alt={`${film.title} poster`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-base-700 to-base-900 p-4">
              <span className="text-center font-display text-lg font-semibold text-zinc-300">
                {film.title}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-5 sm:p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h2 id="movie-modal-title" className="font-display text-2xl font-bold text-white">
                {film.title}
              </h2>
              <p className="text-sm text-zinc-500">
                {film.year ?? '—'}
                {film.genres.length > 0 && ` · ${film.genres.join(', ')}`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          {film.rating != null && (
            <p className="mb-3 text-sm text-gold">{stars(film.rating)}</p>
          )}

          {/* Tagline */}
          {film.tagline && (
            <p className="mb-3 border-l-2 border-accent/60 pl-3 font-display text-base italic leading-snug text-zinc-300">
              “{film.tagline}”
            </p>
          )}

          {/* Synopsis */}
          {film.synopsis && (
            <p className="mb-4 text-sm leading-relaxed text-zinc-300">{film.synopsis}</p>
          )}

          {/* Meta row: director, runtime, rating */}
          {(film.director || film.runtime) && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-white/10 py-3 text-xs">
              {film.director && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-zinc-500">Directed by</span>
                  <span className="font-medium text-zinc-200">{film.director}</span>
                </span>
              )}
              {film.runtime && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-zinc-500">Runtime</span>
                  <span className="font-medium text-zinc-200">{film.runtime}</span>
                </span>
              )}
              
            </div>
          )}

          {/* Influenced by */}
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Influenced by
            </h3>
            <div className="flex flex-col gap-2">
              {influencedBy.map((inf) => (
                <div key={inf.friendId} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] font-bold text-accent-soft">
                    {inf.friendName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-zinc-200">{inf.friendName}</span>
                      <span className="text-xs text-zinc-500">
                        {inf.friendRating != null ? `${stars(inf.friendRating)}` : 'watched'}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-base-700/70">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft"
                        style={{ width: `${inf.friendScore}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deterministic reasons */}
          {reasons.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {reasons.map((r) => (
                <span key={r} className="chip">
                  {r}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="w-32">
              <TasteMeter score={score} size="sm" />
            </div>
            <div className="flex gap-2">
              <a
                href={`https://letterboxd.com/film/${film.slug}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost !px-4 !py-2 text-xs"
              >
                Letterboxd ↗
              </a>
              <button
                type="button"
                onClick={() => onMoreLikeThis(movie)}
                className="btn-primary !px-4 !py-2 text-xs"
              >
                More like this
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}