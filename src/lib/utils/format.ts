// ─── Small formatting helpers ───────────────────────────────────────────

/** Format a 0–100 score as a percentage string. */
export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** Format a rating (0.5–5) as a star string. */
export function stars(rating: number | null): string {
  if (rating == null) return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? '½' : '';
  return '★'.repeat(full) + half;
}

/** Humanize a match label. */
export function matchLabelText(label: string): string {
  switch (label) {
    case 'excellent':
      return 'Excellent match';
    case 'good':
      return 'Good match';
    case 'mixed':
      return 'Mixed match';
    default:
      return 'Low match';
  }
}

/** Shorten a long string for UI display. */
export function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Format an ISO date as a short human date. */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Deterministic pseudo-random shuffle (seeded) for "shuffle" feature. */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed || 1;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}