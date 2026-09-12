'use client';

import { useMemo, useState } from 'react';
import type { CandidateMovie, RecommendationResult } from '@/lib/types';
import { MovieCard } from '@/components/MovieCard';
import { MovieModal } from '@/components/MovieModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { seededShuffle } from '@/lib/utils/format';

interface Props {
  result: RecommendationResult;
  onRegenerate: () => void;
  regenerating: boolean;
  onBack: () => void;
  onToast: (text: string, tone?: 'info' | 'error' | 'success') => void;
}

export function Recommendations({ result, onRegenerate, regenerating, onBack, onToast }: Props) {
  const [selected, setSelected] = useState<CandidateMovie | null>(null);
  const [genreFilter, setGenreFilter] = useState<string | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [shuffled, setShuffled] = useState(false);

  // Available genre filters from the candidate pool.
  const availableGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of result.candidates) {
      for (const g of c.film.genres) {
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [result.candidates]);

  const filtered = useMemo(() => {
    let list = result.candidates;
    if (genreFilter) {
      list = list.filter((c) => c.film.genres.includes(genreFilter));
    }
    if (shuffled) {
      list = seededShuffle(list, shuffleSeed);
    }
    return list;
  }, [result.candidates, genreFilter, shuffled, shuffleSeed]);

  const toggleShuffle = () => {
    if (shuffled) {
      setShuffled(false);
      setShuffleSeed(0);
    } else {
      setShuffleSeed(Date.now() % 100000);
      setShuffled(true);
    }
  };

  const moreLikeThis = (movie: CandidateMovie) => {
    const genres = movie.film.genres;
    if (genres.length === 0) {
      onToast('No genre data for this film to find look-alikes.', 'info');
      return;
    }
    setGenreFilter(genres[0]);
    setSelected(null);
    onToast(`Showing more like “${movie.film.title}” (${genres[0]}).`, 'success');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 animate-fade-up">
      <header className="mb-8 text-center">
        <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
          Tonight’s <span className="accent-gradient">picks</span>
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
          {result.candidates.length} films curated from your friends’ watchlists
          {result.genre ? ` for “${result.genre}”` : ''}.
          {result.aiUsed ? ' ✨ AI-refined' : ''}
        </p>
        {result.degraded && (
          <p className="mx-auto mt-2 max-w-md text-xs text-amber-300">
            The pool was small, so picks are limited — try adding more friends.
          </p>
        )}
      </header>

      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="btn-ghost !py-2 text-xs" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn-ghost !py-2 text-xs" onClick={onRegenerate} disabled={regenerating}>
          {regenerating ? <Spinner size={14} /> : '↻'} Regenerate
        </button>
        <button type="button" className="btn-ghost !py-2 text-xs" onClick={toggleShuffle}>
          {shuffled ? '↺ Unshuffle' : '🔀 Shuffle'}
        </button>
        {genreFilter && (
          <button
            type="button"
            className="btn-ghost !py-2 text-xs text-accent-soft"
            onClick={() => setGenreFilter(null)}
          >
            ✕ Clear filter ({genreFilter})
          </button>
        )}
      </div>

      {/* Genre filter chips */}
      {availableGenres.length > 0 && (
        <div className="no-scrollbar mb-8 flex gap-2 overflow-x-auto pb-1">
          {availableGenres.map(([g, count]) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenreFilter(genreFilter === g ? null : g)}
              className={`chip shrink-0 ${genreFilter === g ? 'chip-active' : ''}`}
            >
              {g} <span className="text-zinc-500">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((movie, i) => (
            <MovieCard key={`${movie.film.slug}-${i}`} movie={movie} index={i} onOpen={setSelected} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🎞️"
          title="No films match that filter"
          description="Try clearing the genre filter or regenerating with a different mood."
          action={
            <button type="button" className="btn-ghost" onClick={() => setGenreFilter(null)}>
              Clear filter
            </button>
          }
        />
      )}

      <MovieModal movie={selected} onClose={() => setSelected(null)} onMoreLikeThis={moreLikeThis} />
    </section>
  );
}