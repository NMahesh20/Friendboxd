'use client';

import { matchLabelText } from '@/lib/utils/format';

const LABEL_COLORS: Record<string, string> = {
  excellent: 'text-emerald-400',
  good: 'text-sky-400',
  mixed: 'text-amber-400',
  low: 'text-zinc-400',
};

const BAR_COLORS: Record<string, string> = {
  excellent: 'from-emerald-500 to-emerald-300',
  good: 'from-sky-500 to-sky-300',
  mixed: 'from-amber-500 to-amber-300',
  low: 'from-zinc-500 to-zinc-400',
};

export function TasteMeter({
  score,
  label,
  size = 'md',
}: {
  score: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const resolvedLabel = label ?? (score >= 75 ? 'excellent' : score >= 50 ? 'good' : score >= 25 ? 'mixed' : 'low');
  const barColor = BAR_COLORS[resolvedLabel] ?? BAR_COLORS.low;
  const textColor = LABEL_COLORS[resolvedLabel] ?? LABEL_COLORS.low;

  const height = size === 'lg' ? 'h-3' : size === 'sm' ? 'h-1.5' : 'h-2';
  const textSize = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg';

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className={`font-display font-semibold ${textSize} ${textColor}`}>
          {Math.round(score)}%
        </span>
        <span className={`text-xs font-medium ${textColor}`}>{matchLabelText(resolvedLabel)}</span>
      </div>
      <div className={`w-full overflow-hidden rounded-full bg-base-700/70 ${height}`}>
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-700 ease-out`}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}