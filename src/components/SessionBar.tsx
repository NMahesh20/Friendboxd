'use client';

import { useState } from 'react';

export function SessionBar({
  username,
  selectedCount,
  genre,
  onReset,
  onConfirmReset,
}: {
  username: string | null;
  selectedCount: number;
  genre: string | null;
  onReset: () => void;
  onConfirmReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!username) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-white/10 bg-base-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
          <span className="font-semibold text-white">@{username}</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">{selectedCount} friend{selectedCount === 1 ? '' : 's'}</span>
          {genre && (
            <>
              <span className="hidden sm:inline">·</span>
              <span className="truncate text-accent-soft">“{genre}”</span>
            </>
          )}
        </div>

        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Clear session?</span>
            <button
              type="button"
              className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/30"
              onClick={() => {
                onReset();
                setConfirming(false);
              }}
            >
              Yes, reset
            </button>
            <button
              type="button"
              className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/10"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => setConfirming(true)}
          >
            Reset session
          </button>
        )}
      </div>
    </div>
  );
}