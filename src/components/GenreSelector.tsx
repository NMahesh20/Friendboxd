'use client';

import { useState, type FormEvent } from 'react';
import { GENRES } from '@/lib/utils/genres';
import { validateGenre } from '@/lib/utils/validation';
import { classifyMood } from '@/lib/client/api';
import { Spinner } from '@/components/ui/Spinner';

const MOOD_PRESETS = [
  { label: '😱 Scary', value: 'scary' },
  { label: '😂 Funny', value: 'funny' },
  { label: '🥲 Emotional', value: 'emotional' },
  { label: '🔥 Action', value: 'action' },
  { label: '🧠 Mind-bending', value: 'mindbending' },
  { label: '🛋️ Cozy', value: 'cozy' },
  { label: '🌌 Sci-fi', value: 'scifi' },
  { label: '🕵️ Mystery', value: 'mystery' },
  { label: '💘 Romance', value: 'romance' },
  { label: '🎞️ Classic', value: 'classic' },
];

export function GenreSelector({
  initial,
  onSelect,
  onBack,
  onToast,
}: {
  initial: string | null;
  onSelect: (genre: string) => void;
  onBack: () => void;
  onToast?: (text: string, tone?: 'info' | 'error' | 'success') => void;
}) {
  const [custom, setCustom] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initial);
  const [submitting, setSubmitting] = useState(false);

  const choose = (value: string) => {
    setSelected(value);
    setCustom('');
    setError(null);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = custom.trim() || selected || '';
    const check = validateGenre(raw);
    if (!check.ok || !check.value) {
      setError(check.error ?? 'Please pick a genre or mood.');
      return;
    }

    // Quick vibes + genre chips go straight through — no AI needed.
    if (!custom.trim()) {
      onSelect(check.value);
      return;
    }

    // Free-text description → ask Gemini to classify it into a Letterboxd
    // genre, then pick the most relevant one. Falls back to local keyword
    // mapping when no key is set or the AI call fails.
    setSubmitting(true);
    setError(null);
    try {
      const res = await classifyMood(custom.trim());
      if (res.genre) {
        onToast?.(`✨ AI matched your vibe to “${res.genre}”.`, 'success');
        onSelect(res.genre);
        return;
      }
    } catch {
      // AI unavailable — silently fall back to local mapping.
    } finally {
      setSubmitting(false);
    }
    onSelect(check.value);
  };

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10 animate-fade-up">
      <header className="mb-8 text-center">
        <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
          What are you <span className="accent-gradient">in the mood for?</span>
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
          Pick a genre or describe a vibe — we’ll use it to surface the best picks from your
          friends’ watchlists.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-6" noValidate>
        {/* Mood presets */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Quick vibes
          </h3>
          <div className="flex flex-wrap gap-2">
            {MOOD_PRESETS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => choose(m.value)}
                className={`chip ${selected === m.value ? 'chip-active' : ''}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Genres */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Or a genre
          </h3>
          <div className="flex flex-wrap gap-2">
            {GENRES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => choose(g)}
                className={`chip ${selected === g ? 'chip-active' : ''}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Custom vibe */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Or describe it
          </h3>
          <input
            type="text"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setSelected(null);
              setError(null);
            }}
            placeholder="e.g. “a rainy Sunday, something slow and beautiful”"
            className="input-dark"
          />
          {error && (
            <p className="mt-1.5 text-xs text-red-400 animate-fade-in" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <button type="button" className="btn-ghost" onClick={onBack}>
            ← Back
          </button>
          <button
            type="submit"
            className="btn-primary inline-flex items-center gap-2"
            disabled={(!custom.trim() && !selected) || submitting}
          >
            {submitting ? (
              <>
                <Spinner size={14} /> Matching your vibe…
              </>
            ) : (
              'Get my picks →'
            )}
          </button>
        </div>
      </form>
    </section>
  );
}