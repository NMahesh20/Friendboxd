'use client';

import type { ReactNode } from 'react';

export function EmptyState({
  icon = '🎬',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-14 text-center animate-fade-up">
      <div className="text-4xl">{icon}</div>
      <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
      <p className="max-w-sm text-sm text-zinc-400">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}