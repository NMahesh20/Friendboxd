'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CandidateMovie, RecommendationResult } from '@/lib/types';
import { MovieCard } from '@/components/MovieCard';
import { MovieModal } from '@/components/MovieModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { AiBadge } from '@/components/ui/AiBadge';
import { refineRecommendations, ApiError } from '@/lib/client/api';

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
  const [refining, setRefining] = useState(false);
  const [refinedCandidates, setRefinedCandidates] = useState<CandidateMovie[] | null>(null);

  // Current picks — replaced in place when the user runs "AI refine".
  const candidates = refinedCandidates ?? result.candidates;

  // A fresh recommendation result supersedes any in-place AI refinement.
  useEffect(() => {
    setRefinedCandidates(null);
  }, [result.generatedAt]);

  // Available genre filters from the candidate pool.
  const availableGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of candidates) {
      for (const g of c.film.genres) {
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [candidates]);

  const filtered = useMemo(() => {
    let list = candidates;
    if (genreFilter) {
      list = list.filter((c) => c.film.genres.includes(genreFilter));
    }
    return list;
  }, [candidates, genreFilter]);

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

  const handleRefine = async () => {
    if (!result.aiEnabled || refining) return;
    setRefining(true);
    try {
      const res = await refineRecommendations(candidates, result.genre);
      if (res.aiUsed) {
        setRefinedCandidates(res.candidates);
        onToast('✨ AI-refined your picks.', 'success');
      } else if (res.aiError) {
        onToast('AI refine is temporarily unavailable — please try again later.', 'error');
      } else {
        onToast('AI refine didn’t change anything — try again.', 'info');
      }
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'AI refine failed.', 'error');
    } finally {
      setRefining(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 animate-fade-up">
      <header className="mb-8 text-center">
        <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
          Tonight’s <span className="accent-gradient">picks</span>
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
          {candidates.length} films curated from your friends’ watchlists
          {result.genre ? ` for “${result.genre}”` : ''}.
          {result.aiUsed ? (
            <span className="inline-flex items-center gap-1">✨ AI-refined</span>
          ) : !result.aiEnabled ? (
            <span className="inline-flex items-center gap-1">
              {/* <AiBadge /> */}
            </span>
          ) : (
            ''
          )}
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
        <button
          type="button"
          className="btn-ghost !py-2 text-xs"
          onClick={handleRefine}
          disabled={!result.aiEnabled || refining}
          title={
            result.aiEnabled
              ? 'Refine picks with AI'
              : 'Add an OpenAI API key to enable AI refine'
          }
        >
          {refining ? <Spinner size={14} /> : '✨'} AI refine
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
            <MovieCard
              key={`${movie.film.slug}-${i}`}
              movie={movie}
              index={i}
              onOpen={setSelected}
              aiEnabled={result.aiEnabled}
            />
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

      <MovieModal
        movie={selected}
        onClose={() => setSelected(null)}
        onMoreLikeThis={moreLikeThis}
      />
    </section>
  );
}