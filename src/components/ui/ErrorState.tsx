'use client';

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-6 py-10 text-center animate-fade-up">
      <div className="text-3xl">⚠️</div>
      <h3 className="font-display text-lg font-semibold text-red-300">{title}</h3>
      <p className="max-w-sm text-sm text-zinc-400">{message}</p>
      {onRetry && (
        <button className="btn-ghost mt-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}