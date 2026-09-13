'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { analyzeTaste, getRecommendations, ApiError } from '@/lib/client/api';
import { Landing } from '@/components/Landing';
import { Analyzing } from '@/components/Analyzing';
import { FriendDiscovery } from '@/components/FriendDiscovery';
import { GenreSelector } from '@/components/GenreSelector';
import { Recommendations } from '@/components/Recommendations';
import { SessionBar } from '@/components/SessionBar';
import { Stepper, type StepId } from '@/components/Stepper';
import { ToastStack, useToast } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Spinner';
import type { Friend } from '@/lib/types';

type Step = 'landing' | 'analyzing' | 'friends' | 'genre' | 'recommendations';

export default function Home() {
  const session = useSession();
  const { toasts, push } = useToast();

  const [step, setStep] = useState<Step>('landing');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingUser, setAnalyzingUser] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(true);

  // Always-current session data (avoids stale closures in callbacks).
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const resumedRef = useRef(false);

  // ── Resume from session once hydration completes ──────────────────────
  useEffect(() => {
    if (!session.hydrated || resumedRef.current) return;
    resumedRef.current = true;
    setResuming(false);

    const s = sessionRef.current;
    if (s.lastResults) {
      setStep('recommendations');
    } else if (s.genre) {
      setStep('genre');
    } else if (s.discovered) {
      setStep('friends');
    } else if (s.username) {
      // Username saved but analysis missing → re-run automatically.
      setStep('analyzing');
      void runAnalyze(s.username);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.hydrated]);

  const runAnalyze = useCallback(async (username: string, matchTaste = false) => {
    setAnalyzing(true);
    setAnalyzingUser(username);
    setAnalyzeError(null);
    setStep('analyzing');
    try {
      const result = await analyzeTaste(username, matchTaste);
      const s = sessionRef.current;
      s.setUsername(username);
      s.setDiscovered(result);
      // Preserve previously selected friends that still exist.
      const valid = s.selectedFriendIds.filter((id) => result.friends.some((f) => f.id === id));
      s.setSelected(valid);
      setStep('friends');
    } catch (err) {
      setAnalyzeError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setStep('landing');
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const toggleFriend = useCallback((id: string) => {
    const s = sessionRef.current;
    const current = s.selectedFriendIds;
    if (current.includes(id)) {
      s.setSelected(current.filter((x) => x !== id));
      // Drop the weight for deselected friends.
      const next = { ...s.friendWeights };
      delete next[id];
      s.setWeights(next);
    } else {
      s.setSelected([...current, id]);
      // Default weight 50 (neutral) when first selected.
      if (s.friendWeights[id] === undefined) {
        s.setWeights({ ...s.friendWeights, [id]: 50 });
      }
    }
  }, []);

  const setFriendWeight = useCallback((id: string, weight: number) => {
    const s = sessionRef.current;
    s.setWeights({ ...s.friendWeights, [id]: Math.min(100, Math.max(0, Math.round(weight))) });
  }, []);

  const addManualFriend = useCallback((friend: Friend) => {
    const s = sessionRef.current;
    if (s.discovered) {
      s.setDiscovered({
        ...s.discovered,
        friends: [...s.discovered.friends, friend],
      });
    }
    s.setManual([...s.manualFriendIds, friend.id]);
    s.setSelected([...s.selectedFriendIds, friend.id]);
  }, []);

  const removeManualFriend = useCallback((id: string) => {
    const s = sessionRef.current;
    s.setManual(s.manualFriendIds.filter((x) => x !== id));
    s.setSelected(s.selectedFriendIds.filter((x) => x !== id));
    if (s.discovered) {
      s.setDiscovered({
        ...s.discovered,
        friends: s.discovered.friends.filter((f) => f.id !== id),
      });
    }
  }, []);

  const runRecommend = useCallback(async (genre: string) => {
    const s = sessionRef.current;
    if (!s.username) return;
    setRecommending(true);
    setRecommendError(null);
    try {
      const result = await getRecommendations(
        s.username,
        s.selectedFriendIds,
        genre,
        s.friendWeights,
      );
      s.setResults(result);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not generate picks.';
      setRecommendError(msg);
      push(msg, 'error');
    } finally {
      setRecommending(false);
    }
  }, [push]);

  const selectGenre = useCallback(
    async (genre: string) => {
      sessionRef.current.setGenre(genre);
      setStep('recommendations');
      await runRecommend(genre);
    },
    [runRecommend],
  );

  const regenerate = useCallback(() => {
    const genre = sessionRef.current.genre;
    if (genre) void runRecommend(genre);
  }, [runRecommend]);

  const resetSession = useCallback(() => {
    sessionRef.current.reset();
    setStep('landing');
    setAnalyzeError(null);
    setRecommendError(null);
    push('Session cleared.', 'success');
  }, [push]);

  // ── Render ────────────────────────────────────────────────────────────

  if (resuming) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner size={28} className="text-accent" />
      </main>
    );
  }

  const stepperStep: StepId | null =
    step === 'friends'
      ? 'friends'
      : step === 'genre'
        ? 'mood'
        : step === 'recommendations'
          ? 'picks'
          : null;

  return (
    <main className="relative flex min-h-screen flex-col">
      <SessionBar
        username={session.username}
        selectedCount={session.selectedFriendIds.length}
        genre={session.genre}
        onReset={resetSession}
        onConfirmReset={resetSession}
      />

      {stepperStep && (
        <div className="pt-6">
          <Stepper current={stepperStep} />
        </div>
      )}

      <div className="flex flex-1 flex-col">
        {step === 'landing' && (
        <Landing onAnalyze={runAnalyze} loading={analyzing} error={analyzeError} />
      )}

      {step === 'analyzing' && analyzingUser && <Analyzing username={analyzingUser} />}

      {step === 'friends' && session.discovered && (
        <FriendDiscovery
          discovered={session.discovered}
          selectedIds={session.selectedFriendIds}
          manualIds={session.manualFriendIds}
          weights={session.friendWeights}
          onToggle={toggleFriend}
          onWeightChange={setFriendWeight}
          onAddManual={addManualFriend}
          onRemoveManual={removeManualFriend}
          onContinue={() => setStep('genre')}
          onBack={() => setStep('landing')}
          onToast={push}
        />
      )}

      {step === 'genre' && (
        <GenreSelector
          initial={session.genre}
          onSelect={selectGenre}
          onBack={() => setStep('friends')}
        />
      )}

      {step === 'recommendations' && (
        <>
          {recommending && !session.lastResults ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
              <Spinner size={28} className="text-accent" />
              <p className="text-sm text-zinc-400">
                Curating picks from your friends’ watchlists…
              </p>
            </div>
          ) : session.lastResults ? (
            <Recommendations
              result={session.lastResults}
              onRegenerate={regenerate}
              regenerating={recommending}
              onBack={() => setStep('genre')}
              onToast={push}
            />
          ) : (
            <div className="flex min-h-[50vh] items-center justify-center px-4">
              <p className="text-sm text-red-400">{recommendError ?? 'No recommendations yet.'}</p>
            </div>
          )}
        </>
      )}

      </div>

      <footer className="mt-auto border-t border-white/5 py-8 text-center text-xs text-zinc-600">
        <p className="mt-2">
          Friendboxd · Recommendations are based on your friends’ public Letterboxd activity ·
          Data stays in your browser session
        </p>
        <p>
          Built by{' '}
          <a
            href="https://github.com/NMahesh20/Friendboxd"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 transition-colors hover:text-white"
          >
            Mahesh
          </a>{' '}
          × AI — {new Date().getFullYear()}
        </p>
        </footer>

      <ToastStack toasts={toasts} />
    </main>
  );
}