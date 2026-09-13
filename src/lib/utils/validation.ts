// ─── Input validation helpers ───────────────────────────────────────────

// Letterboxd usernames are restricted to letters, numbers and underscores.
const USERNAME_RE = /^[a-z0-9_]{1,40}$/i;

export interface ValidationResult {
  ok: boolean;
  value?: string;
  error?: string;
}

/**
 * Strip any character that isn't allowed in a Letterboxd username
 * (A–Z, a–z, 0–9, _). Used to filter input fields as the user types.
 */
export function sanitizeUsernameInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, '');
}

/** Normalize + validate a Letterboxd username. */
export function validateUsername(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!value) {
    return { ok: false, error: 'Please enter your Letterboxd username.' };
  }
  if (value.includes('/')) {
    // Allow pasting a full profile URL.
    const match = value.match(/letterboxd\.com\/([a-z0-9_]+)/i);
    if (match) {
      return { ok: true, value: match[1].toLowerCase() };
    }
    return { ok: false, error: 'That doesn’t look like a Letterboxd username or URL.' };
  }
  if (!USERNAME_RE.test(value)) {
    return {
      ok: false,
      error: 'Usernames can only contain letters, numbers and underscores.',
    };
  }
  return { ok: true, value };
}

/** Validate a free-text genre / mood description. */
export function validateGenre(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? '').trim();
  if (!value) {
    return { ok: false, error: 'Pick a genre or describe a vibe.' };
  }
  if (value.length > 120) {
    return { ok: false, error: 'Keep it under 120 characters.' };
  }
  return { ok: true, value };
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}