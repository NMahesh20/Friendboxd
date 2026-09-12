'use client';

const STEPS = [
  { id: 'taste', label: 'Your taste' },
  { id: 'friends', label: 'Pick friends' },
  { id: 'mood', label: 'Pick a mood' },
  { id: 'picks', label: 'Your picks' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

export function Stepper({ current }: { current: StepId }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <nav aria-label="Progress" className="mx-auto flex w-full max-w-md items-center gap-2 px-4">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={step.id} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300 ${
                done
                  ? 'border-accent bg-accent text-white'
                  : active
                    ? 'border-accent/70 bg-accent/15 text-accent'
                    : 'border-white/15 bg-white/5 text-zinc-500'
              }`}
            >
              {done ? '✓' : i + 1}
            </div>
            <span
              className={`text-[10px] font-medium uppercase tracking-wide ${
                active ? 'text-zinc-200' : 'text-zinc-500'
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </nav>
  );
}