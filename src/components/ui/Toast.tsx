'use client';

import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  tone?: 'info' | 'error' | 'success';
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const push = (text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  };

  return { toasts, push };
}

const TONE_STYLES: Record<string, string> = {
  info: 'border-white/15 bg-base-800 text-zinc-100',
  error: 'border-red-500/40 bg-red-950/90 text-red-100',
  success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100',
};

export function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto w-full rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md animate-fade-up ${TONE_STYLES[t.tone ?? 'info']}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}