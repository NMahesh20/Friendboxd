'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { AnalyzeResult, Friend, TasteMatch } from '@/lib/types';
import { MAX_SELECTED_FRIENDS } from '@/lib/config';
import { sanitizeUsernameInput, validateUsername } from '@/lib/utils/validation';
import { TasteMeter } from '@/components/ui/TasteMeter';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ApiError, validateFriend } from '@/lib/client/api';

interface Props {
  discovered: AnalyzeResult;
  selectedIds: string[];
  manualIds: string[];
  weights: Record<string, number>;
  onToggle: (id: string) => void;
  onWeightChange: (id: string, weight: number) => void;
  onAddManual: (friend: Friend) => void;
  onRemoveManual: (id: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onToast: (text: string, tone?: 'info' | 'error' | 'success') => void;
}

export function FriendDiscovery({
  discovered,
  selectedIds,
  manualIds,
  weights,
  onToggle,
  onWeightChange,
  onAddManual,
  onRemoveManual,
  onContinue,
  onBack,
  onToast,
}: Props) {
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selectedCount = selectedIds.length;
  const atLimit = selectedCount >= MAX_SELECTED_FRIENDS;

  const matchById = useMemo(() => {
    const map = new Map<string, TasteMatch>();
    for (const m of discovered.matches) map.set(m.friendId, m);
    return map;
  }, [discovered.matches]);

  const manualFriends = useMemo(() => {
    return discovered.friends.filter((f) => manualIds.includes(f.id));
  }, [discovered.friends, manualIds]);

  const discoveredFriends = useMemo(() => {
    return discovered.friends.filter((f) => !manualIds.includes(f.id));
  }, [discovered.friends, manualIds]);

  const addManual = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const check = validateUsername(manualInput);
    if (!check.ok || !check.value) {
      setManualError(check.error ?? 'Invalid username.');
      return;
    }
    const id = check.value;

    // Duplicate checks.
    if (selectedIds.includes(id) || manualIds.includes(id)) {
      setManualError('That friend is already in your list.');
      return;
    }
    if (selectedCount >= MAX_SELECTED_FRIENDS) {
      setManualError(`You can select up to ${MAX_SELECTED_FRIENDS} friends.`);
      return;
    }

    setAdding(true);
    setManualError(null);
    try {
      const { friend } = await validateFriend(id);
      onAddManual(friend);
      setManualInput('');
      onToast(`${friend.name} added to your list.`, 'success');
    } catch (err) {
      if (err instanceof ApiError) {
        setManualError(err.message);
      } else {
        setManualError('Could not add that friend. Please try again.');
      }
    } finally {
      setAdding(false);
    }
  };

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onToggle(id);
      return;
    }
    if (atLimit) {
      onToast(`You can select up to ${MAX_SELECTED_FRIENDS} friends.`, 'error');
      return;
    }
    onToggle(id);
  };

  const renderFriendRow = (friend: Friend, index: number) => {
    const match = matchById.get(friend.id);
    const selected = selectedIds.includes(friend.id);
    const disabled = !selected && atLimit;
    const weight = weights[friend.id] ?? 50;

    return (
      <div
        key={friend.id}
        className={`overflow-hidden rounded-2xl border transition-all duration-200 ${
          selected
            ? 'border-accent/50 bg-accent/[0.08] shadow-glow'
            : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'
        }`}
        style={{ animationDelay: `${index * 40}ms` }}
      >
        <button
          type="button"
          onClick={() => toggle(friend.id)}
          disabled={disabled}
          aria-pressed={selected}
          className={`group flex w-full items-center gap-4 p-3 text-left transition-colors ${
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
        >
          <div className="relative shrink-0">
            {friend.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={friend.avatar}
                alt=""
                className="h-12 w-12 rounded-full border border-white/10 object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-base-700 font-display text-lg font-semibold text-zinc-300">
                {friend.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-base-900 text-[10px] font-bold transition-all ${
                selected ? 'bg-accent text-white' : 'bg-base-700 text-transparent'
              }`}
            >
              ✓
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-medium text-white">{friend.name}</span>
              <span className="truncate text-xs text-zinc-500">@{friend.id}</span>
            </div>
            {friend.films.length > 0 && (
              <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                <span>{friend.films.length} films</span>
                {friend.unavailable && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                    unavailable
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="w-28 shrink-0 sm:w-32">
            {match ? (
              <TasteMeter score={match.score} label={match.label} size="sm" />
            ) : (
              <span className="text-xs text-zinc-500">—</span>
            )}
          </div>
        </button>

        {/* Custom taste weight for selected friends */}
        {selected && (
          <div className="border-t border-white/10 px-4 pb-3 pt-2.5 animate-fade-in">
            <div className="flex items-center justify-between">
              <label
                htmlFor={`weight-${friend.id}`}
                className="text-xs font-medium text-zinc-400"
              >
                Taste weight
              </label>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white">
                {weight}
              </span>
            </div>
            <input
              id={`weight-${friend.id}`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={weight}
              onChange={(e) => onWeightChange(friend.id, Number(e.target.value))}
              className="mt-2 w-full accent-accent"
              aria-label={`Taste weight for ${friend.name}`}
            />
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
              Higher = this friend’s picks count more toward your recommendations.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10 animate-fade-up">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Back to start
      </button>
      <header className="mb-8 text-center">
        <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
          Pick your <span className="accent-gradient">taste crew</span>
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
          We ranked {discovered.friends.length} friends by how closely their taste matches yours.
          Choose up to {MAX_SELECTED_FRIENDS} to tune your recommendations.
        </p>
      </header>

      {/* Crawl warnings / blocked banner */}
      {discovered.warnings.length > 0 && (
        <div className="mb-6 space-y-2">
          {discovered.warnings.map((w) => (
            <div
              key={w}
              className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200 animate-fade-in"
            >
              <span aria-hidden="true">⚠️</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
      {discovered.blocked && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-accent/[0.08] px-4 py-3 text-sm text-zinc-200 animate-fade-in">
          <span className="font-semibold text-white">Automated discovery is blocked.</span>{' '}
          Add friends manually below — we’ll still compute taste matches and recommendations.
        </div>
      )}

      {/* Selection counter */}
      <div className="mb-6 flex items-center justify-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
          <span className="text-sm font-semibold text-white">
            {selectedCount} / {MAX_SELECTED_FRIENDS}
          </span>
          <span className="text-xs text-zinc-400">selected</span>
        </div>
        {atLimit && (
          <span className="text-xs text-amber-300 animate-fade-in">
            You can select up to {MAX_SELECTED_FRIENDS} friends to tune your recommendations
          </span>
        )}
      </div>

      {/* Manual add */}
      <form
        onSubmit={addManual}
        className="mb-8 flex flex-col gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4 sm:flex-row sm:items-center"
        noValidate
      >
        <div className="flex-1">
          <label htmlFor="manual-friend" className="mb-1 block text-xs font-medium text-zinc-400">
            Missed someone? Add a friend manually
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              @
            </span>
            <input
              id="manual-friend"
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(sanitizeUsernameInput(e.target.value))}
              placeholder="friend-username"
              className="input-dark pl-8"
              disabled={adding || atLimit}
            />
          </div>
          {manualError && (
            <p className="mt-1.5 text-xs text-red-400 animate-fade-in" role="alert">
              {manualError}
            </p>
          )}
        </div>
        <button
          type="submit"
          className="btn-ghost mt-2 sm:mt-6"
          disabled={adding || atLimit || !manualInput.trim()}
        >
          {adding ? <Spinner size={14} /> : '+ Add'}
        </button>
      </form>

      {/* Manual friends (added) */}
      {manualFriends.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Manually added
          </h3>
          <div className="flex flex-col gap-2">
            {manualFriends.map((f, i) => (
              <div key={f.id} className="relative">
                {renderFriendRow(f, i)}
                <button
                  type="button"
                  onClick={() => onRemoveManual(f.id)}
                  aria-label={`Remove ${f.name}`}
                  className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-base-800 text-xs text-zinc-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discovered friends */}
      {discoveredFriends.length > 0 ? (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Discovered from your following list
          </h3>
          <div className="flex flex-col gap-2">
            {discoveredFriends.map((f, i) => renderFriendRow(f, i))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon="👥"
          title="No friends discovered"
          description="We couldn’t find anyone in your following list. Add friends manually above to get started."
        />
      )}

      {/* Continue */}
      <div className="mt-10 flex justify-center">
        <button
          type="button"
          className="btn-primary"
          onClick={onContinue}
          disabled={selectedCount === 0}
        >
          {selectedCount === 0
            ? 'Select at least one friend'
            : `Continue with ${selectedCount} friend${selectedCount === 1 ? '' : 's'} →`}
        </button>
      </div>
    </section>
  );
}