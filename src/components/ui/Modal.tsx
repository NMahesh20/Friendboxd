'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  // Render at the body level via a portal. The modal is opened from inside
  // animated sections whose retained `transform` (from the fade-up animation)
  // would otherwise break `position: fixed` and misplace the dialog.
  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative z-10 flex min-h-full items-end justify-center sm:items-center sm:p-4">
        <div className="relative w-full max-w-2xl rounded-t-3xl border border-white/10 bg-base-900 shadow-2xl animate-fade-up sm:rounded-3xl">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}