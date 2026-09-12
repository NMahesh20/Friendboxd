'use client';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';

const STEPS = [
  'Opening a stealth session…',
  'Finding your profile…',
  'Discovering who you follow…',
  'Reading your friends’ watchlists…',
  'Comparing tastes…',
  'Ranking your best matches…',
];

export function Analyzing({ username }: { username: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 1800);
    return () => clearInterval(interval);
  }, []);

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
      <p className="mt-3 h-5 text-sm text-zinc-400 transition-all animate-fade-in" key={step}>
        {STEPS[step]}
      </p>

      <div className="mt-8 flex w-full max-w-xs gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-500 ${
              i <= step ? 'bg-accent' : 'bg-base-700'
            }`}
          />
        ))}
      </div>

      <p className="mt-6 max-w-sm text-xs text-zinc-500">
        This can take a minute while we politely browse Letterboxd. Your data stays in this
        browser session.
      </p>
    </section>
  );
}