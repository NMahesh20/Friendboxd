'use client';

import { useState, type FormEvent } from 'react';
import { sanitizeUsernameInput, validateUsername } from '@/lib/utils/validation';
import { Spinner } from '@/components/ui/Spinner';

export function Landing({
  onAnalyze,
  loading,
  error,
}: {
  onAnalyze: (username: string, matchTaste: boolean) => void;
  loading: boolean;
  error: string | null;
}) {
  const [value, setValue] = useState('');
  const [autoMatch, setAutoMatch] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const check = validateUsername(value);
    if (!check.ok || !check.value) {
      setLocalError(check.error ?? 'Invalid username.');
      return;
    }
    setLocalError(null);
    onAnalyze(check.value, autoMatch);
  };

  return (
    <section className="relative flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center animate-fade-up">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-300">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Powered by your friends’ Letterboxd
        </div>

        <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          <span className="text-gradient">What would your</span>
          <br />
          <span className="accent-gradient">friends recommend?</span>
        </h1>

        <p className="mt-5 max-w-lg text-base leading-relaxed text-zinc-400 sm:text-lg">
          Friendboxd crawls your Letterboxd network, finds the friends whose taste matches yours,
          and turns their watchlists into movie picks you’ll actually love.
        </p>

        <form
          onSubmit={submit}
          className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row"
          noValidate
        >
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
              @
            </span>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(sanitizeUsernameInput(e.target.value))}
              placeholder="your-letterboxd-username"
              aria-label="Letterboxd username"
              autoComplete="off"
              spellCheck={false}
              className="input-dark pl-9"
              disabled={loading}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading || !value.trim()}>
            {loading ? (
              <>
                <Spinner size={16} /> Analyzing…
              </>
            ) : (
              <>Analyze my taste →</>
            )}
          </button>
        </form>

        {/* Auto taste-match toggle — off by default; on = slower full crawl. */}
        <div className="mt-6 w-full max-w-md">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-left">
              <p className="text-sm font-medium text-zinc-200">Auto find taste match</p>
              <p className="text-xs text-zinc-500">
                Crawl friends’ watchlists to rank your best matches
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoMatch}
              aria-label="Auto find taste match"
              disabled={loading}
              onClick={() => setAutoMatch((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                autoMatch ? 'bg-accent' : 'bg-base-700'
              } ${loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  autoMatch ? 'translate-x-[22px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {autoMatch && (
            <p
              className="mt-2 flex items-start gap-1.5 text-xs text-amber-400/90 animate-fade-in"
              role="note"
            >
              <span aria-hidden="true">⏱</span>
              <span>
                This may take a few minutes — we’ll read your friends’ watchlists to find your
                best taste matches.
              </span>
            </p>
          )}
        </div>

        {(localError || error) && (
          <p className="mt-4 text-sm text-red-400 animate-fade-in" role="alert">
            {localError ?? error}
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
          <span>🔒 Private profiles handled gracefully</span>
          <span>🎯 Taste-match scoring</span>
          <span>✨ AI-curated picks</span>
        </div>
      </div>
    </section>
  );
}