'use client';

import type { ReactNode } from 'react';

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  action,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Extra action rendered next to "Try again" (e.g. a back button). */
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-6 py-10 text-center animate-fade-up"
    >
      <div className="text-3xl">⚠️</div>
      <h3 className="font-display text-lg font-semibold text-red-300">{title}</h3>
      <p className="max-w-sm text-sm text-zinc-400">{message}</p>
      {(onRetry || action) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <button type="button" className="btn-ghost" onClick={onRetry}>
              Try again
            </button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}