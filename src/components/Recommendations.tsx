'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CandidateMovie, RecommendationResult, SuggestedFilm } from '@/lib/types';
import { MovieCard } from '@/components/MovieCard';
import { MovieModal } from '@/components/MovieModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { refineRecommendations, suggestMoreMovies, ApiError } from '@/lib/client/api';
import { stars } from '@/lib/utils/format';

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

  // "More like this" — AI look-alikes shown alongside the original movie.
  const [moreLikeThisSuggestions, setMoreLikeThisSuggestions] = useState<{
    original: CandidateMovie;
    suggestions: SuggestedFilm[];
    loading: boolean;
  } | null>(null);

  // Current picks — the crawl results, plus any AI movies "More movies" appended.
  const candidates = refinedCandidates ?? result.candidates;

  // A fresh recommendation result supersedes any added AI movies.
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

  const moreLikeThis = async (movie: CandidateMovie) => {
    // Only ever make the AI call when a key is configured — no genre-filter
    // fallback, and no call at all otherwise.
    if (!result.aiEnabled) {
      onToast('Add a Gemini API key to enable AI movie suggestions.', 'info');
      return;
    }
    setSelected(null);
    setMoreLikeThisSuggestions({ original: movie, suggestions: [], loading: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const res = await refineRecommendations([movie], result.genre);
      if (!res.aiUsed || res.aiError) {
        setMoreLikeThisSuggestions(null);
        onToast('AI refine is temporarily unavailable — please try again later.', 'error');
        return;
      }
      const suggestions = (res.candidates?.[0]?.ai?.moreLikeThis ?? []).filter(
        (s) => s.slug !== movie.film.slug,
      );
      if (suggestions.length === 0) {
        setMoreLikeThisSuggestions(null);
        onToast(`No look-alikes found for “${movie.film.title}” — try another film.`, 'info');
        return;
      }
      setMoreLikeThisSuggestions({ original: movie, suggestions, loading: false });
      onToast(`Found ${suggestions.length} look-alikes for “${movie.film.title}”.`, 'success');
    } catch (err) {
      setMoreLikeThisSuggestions(null);
      onToast(err instanceof ApiError ? err.message : 'AI suggestions failed.', 'error');
    }
  };

  // "More movies" — ask Gemini for a few NEW films based on the current
  // picks, then append them to the grid (deduped against what's shown).
  const handleRefine = async () => {
    if (!result.aiEnabled || refining) return;
    setRefining(true);
    try {
      const res = await suggestMoreMovies(candidates, result.genre);
      if (res.aiUsed && res.movies.length > 0) {
        const known = new Set(candidates.map((c) => c.film.slug));
        const fresh = res.movies.filter((m) => !known.has(m.film.slug));
        if (fresh.length > 0) {
          setRefinedCandidates([...candidates, ...fresh]);
          onToast(`✨ Added ${fresh.length} more movies.`, 'success');
        } else {
          onToast('No new movies found — try again.', 'info');
        }
      } else if (res.aiError) {
        onToast('AI refine is temporarily unavailable — please try again later.', 'error');
      } else {
        onToast('No new movies found — try again.', 'info');
      }
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'AI suggestions failed.', 'error');
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

      {/* More like this — AI look-alikes shown alongside the original movie */}
      {moreLikeThisSuggestions && (
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-display text-lg font-bold text-white">
              More like{' '}
              <span className="accent-gradient">
                “{moreLikeThisSuggestions.original.film.title}”
              </span>
            </h3>
            <button
              type="button"
              onClick={() => setMoreLikeThisSuggestions(null)}
              aria-label="Dismiss more-like-this suggestions"
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {/* The original movie the suggestions were built from */}
            <button
              type="button"
              onClick={() => setSelected(moreLikeThisSuggestions.original)}
              className="group w-36 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-base-850 text-left transition-colors hover:border-white/30"
              aria-label={`Open details for ${moreLikeThisSuggestions.original.film.title}`}
            >
              <div className="poster-aspect w-full overflow-hidden bg-base-800">
                {moreLikeThisSuggestions.original.film.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={moreLikeThisSuggestions.original.film.poster}
                    alt={`${moreLikeThisSuggestions.original.film.title} poster`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-base-700 to-base-900 p-2">
                    <span className="text-center text-xs font-semibold text-zinc-300">
                      {moreLikeThisSuggestions.original.film.title}
                    </span>
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="line-clamp-1 text-[11px] font-semibold text-white">
                  {moreLikeThisSuggestions.original.film.title}
                </p>
                <p className="text-[10px] text-zinc-500">Original</p>
              </div>
            </button>

            {/* AI suggestions — click through to their real Letterboxd pages */}
            {moreLikeThisSuggestions.loading ? (
              <div className="flex w-36 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 p-4 text-center">
                <Spinner size={18} />
                <p className="text-[11px] text-zinc-500">Finding look-alikes…</p>
              </div>
            ) : (
              moreLikeThisSuggestions.suggestions.map((s) => (
                <a
                  key={s.letterboxdUrl ?? `${s.title}-${s.year ?? ''}`}
                  href={s.letterboxdUrl ?? `https://letterboxd.com/film/${s.slug ?? ''}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group w-36 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-base-850 transition-colors hover:border-violet-400/50"
                  aria-label={`${s.title} on Letterboxd`}
                >
                  <div className="poster-aspect w-full overflow-hidden bg-base-800">
                    {s.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.poster}
                        alt={`${s.title} poster`}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-base-700 to-base-900 p-2">
                        <span className="text-center text-xs font-semibold text-zinc-300">
                          {s.title}
                        </span>
                      </div>
                    )}
                    {s.rating != null && (
                      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-gold backdrop-blur-sm">
                        {stars(s.rating)}
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-1 text-[11px] font-medium text-zinc-200">{s.title}</p>
                    {s.year != null && <p className="text-[10px] text-zinc-500">{s.year}</p>}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
      )}

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
              ? 'Suggest a few more movies with AI'
              : 'Add a Gemini API key to enable AI suggestions'
          }
        >
          {refining ? <Spinner size={14} /> : '✨'} More movies
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