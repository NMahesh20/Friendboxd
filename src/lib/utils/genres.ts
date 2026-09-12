// ─── Genre + mood helpers ───────────────────────────────────────────────

/** Canonical genre list used for chips and scoring. */
export const GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Music',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Thriller',
  'TV Movie',
  'War',
  'Western',
] as const;

export type Genre = (typeof GENRES)[number];

/** Map a free-text mood/vibe to relevant genres. */
const MOOD_MAP: Record<string, string[]> = {
  scary: ['Horror', 'Thriller', 'Mystery'],
  horror: ['Horror', 'Thriller'],
  spooky: ['Horror', 'Mystery'],
  funny: ['Comedy'],
  comedy: ['Comedy'],
  laugh: ['Comedy'],
  sad: ['Drama', 'Romance'],
  cry: ['Drama', 'Romance'],
  emotional: ['Drama', 'Romance'],
  romance: ['Romance', 'Drama'],
  love: ['Romance', 'Drama'],
  action: ['Action', 'Thriller'],
  adventure: ['Adventure', 'Action'],
  epic: ['Adventure', 'Action', 'War'],
  chill: ['Drama', 'Comedy'],
  cozy: ['Comedy', 'Family', 'Romance'],
  feelgood: ['Comedy', 'Family', 'Romance'],
  happy: ['Comedy', 'Family'],
  dark: ['Thriller', 'Crime', 'Horror'],
  thriller: ['Thriller', 'Crime', 'Mystery'],
  mystery: ['Mystery', 'Thriller'],
  crime: ['Crime', 'Thriller'],
  scifi: ['Sci-Fi', 'Adventure'],
  'sci-fi': ['Sci-Fi', 'Adventure'],
  space: ['Sci-Fi', 'Adventure'],
  fantasy: ['Fantasy', 'Adventure'],
  animated: ['Animation', 'Family'],
  animation: ['Animation', 'Family'],
  documentary: ['Documentary'],
  doc: ['Documentary'],
  war: ['War', 'Drama'],
  western: ['Western', 'Action'],
  classic: ['Drama', 'Romance'],
  retro: ['Drama', 'Comedy'],
  mindbending: ['Sci-Fi', 'Thriller', 'Mystery'],
  trippy: ['Sci-Fi', 'Fantasy'],
  uplifting: ['Drama', 'Comedy'],
  inspiring: ['Drama', 'Documentary'],
  tense: ['Thriller', 'Horror'],
  suspense: ['Thriller', 'Mystery'],
  noir: ['Crime', 'Mystery', 'Thriller'],
  musical: ['Comedy', 'Drama'],
  holiday: ['Comedy', 'Family', 'Romance'],
  christmas: ['Comedy', 'Family'],
  summer: ['Adventure', 'Comedy'],
  roadtrip: ['Adventure', 'Comedy', 'Drama'],
  'coming of age': ['Drama', 'Comedy'],
  comingofage: ['Drama', 'Comedy'],
  heist: ['Crime', 'Thriller', 'Action'],
  superhero: ['Action', 'Adventure', 'Sci-Fi'],
  superheroes: ['Action', 'Adventure', 'Sci-Fi'],
  zombie: ['Horror', 'Action'],
  vampire: ['Horror', 'Fantasy'],
  ghost: ['Horror', 'Mystery'],
  monster: ['Horror', 'Sci-Fi'],
  dystopian: ['Sci-Fi', 'Thriller'],
  postapocalyptic: ['Sci-Fi', 'Action', 'Thriller'],
  'post-apocalyptic': ['Sci-Fi', 'Action', 'Thriller'],
  biopic: ['Drama', 'Documentary'],
  historical: ['Drama', 'War'],
  period: ['Drama', 'Romance'],
  sports: ['Drama', 'Documentary'],
  music: ['Documentary', 'Drama'],
  food: ['Documentary', 'Comedy'],
  nature: ['Documentary'],
  weird: ['Fantasy', 'Comedy', 'Horror'],
  artsy: ['Drama', 'Documentary'],
  indie: ['Drama', 'Comedy'],
  blockbuster: ['Action', 'Adventure', 'Sci-Fi'],
  popcorn: ['Action', 'Comedy', 'Adventure'],
  'feel good': ['Comedy', 'Family', 'Romance'],
  'feel-good': ['Comedy', 'Family', 'Romance'],
  'late night': ['Comedy', 'Horror', 'Thriller'],
  'date night': ['Romance', 'Comedy', 'Drama'],
  'family night': ['Family', 'Animation', 'Adventure'],
  'movie night': ['Action', 'Comedy', 'Thriller'],
};

/**
 * Resolve a genre/mood string into a set of genres.
 * Returns the raw string when no mapping is found (used as a keyword hint).
 */
export function resolveMood(input: string): { genres: string[]; keywords: string[] } {
  const text = input.toLowerCase().trim();
  const genres = new Set<string>();
  const keywords: string[] = [];

  // Exact genre match.
  for (const g of GENRES) {
    if (text === g.toLowerCase() || text.includes(g.toLowerCase())) {
      genres.add(g);
    }
  }

  // Mood keyword match.
  for (const [key, mapped] of Object.entries(MOOD_MAP)) {
    if (text.includes(key)) {
      for (const g of mapped) genres.add(g);
    }
  }

  // Token-level matching for multi-word moods.
  const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    const mapped = MOOD_MAP[token];
    if (mapped) for (const g of mapped) genres.add(g);
  }

  if (genres.size === 0) {
    keywords.push(text);
  }
  return { genres: [...genres], keywords };
}

/** Normalize a genre string for comparison. */
export function normalizeGenre(g: string): string {
  return g.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Letterboxd URL slug for a genre (e.g. "Sci-Fi" → "science-fiction"). */
export function genreSlug(genre: string): string {
  const lower = genre.toLowerCase();
  if (lower === 'sci-fi') return 'science-fiction';
  if (lower === 'tv movie') return 'tv-movie';
  return lower
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Genres to use for the genre-filtered crawl URL. Prefers the exact
 * selected genre when the input is one (e.g. "war" → ["War"]); otherwise
 * expands the mood into its mapped genres (joined with "+" in the URL).
 */
export function genresForUrl(genreMood: string): string[] {
  const text = genreMood.toLowerCase().trim();
  const exact = GENRES.find((g) => g.toLowerCase() === text);
  if (exact) return [exact];
  return resolveMood(genreMood).genres;
}