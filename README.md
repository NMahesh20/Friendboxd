# 🎬 Friendboxd

**Movie picks from your friends.**

Enter your Letterboxd username and Friendboxd quietly reads your friends' public watchlists, figures out whose taste is closest to yours, and serves up a personalized slate of recommendations — complete with synopses, taglines, directors, and runtimes pulled straight from Letterboxd.

> Built by [Mahesh](https://github.com/NMahesh20/Friendboxd) × AI — 2026

---

## ✨ Features

- **Taste matching** — compares your watch history against each friend's using 5 weighted signals (rating overlap, genre overlap, list overlap, review consistency, recency) to produce a 0–100 match score.
- **Friend weightage** — pick up to 5 friends and dial each one's influence from 0–100% (50 = neutral, 100 = 2×, 0 = excluded).
- **Genre / mood filter** — ask for a vibe ("something cozy", "edge-of-your-seat thriller") and the engine re-ranks accordingly.
- **Real Letterboxd data** — every recommendation card shows the official synopsis, tagline, director, and runtime scraped from the film's Letterboxd page.
- **AI layer (optional)** — an OpenAI-compatible model writes a one-line reason and "more like this" picks. Falls back to deterministic reasons when no API key is set, so the app works with or without AI.
- **Session persistence** — your username, friends, weights, and results live in `sessionStorage`, so refreshing resumes exactly where you left off.
- **Graceful degradation** — if Letterboxd blocks crawling, the app falls back to manual friend entry instead of breaking.
- **Dark cinematic UI** — Letterboxd-inspired dark theme with gold accents, poster grids, and smooth animations.

---

## 🧠 How it works

```
Browser (React)  →  Next.js API routes  →  Crawler  →  Scoring engine  →  AI layer
     │                    │                  │              │              │
 sessionStorage      /api/analyze        cheerio/HTTP     taste-match    OpenAI (optional)
     │                    │              + Playwright       + candidates   + deterministic
     │                    │                 fallback           │              fallback
     └────── state persists across reloads ────────────────────┘
```

### 1. Crawler (`src/lib/crawler/`)
Fetches Letterboxd pages with realistic browser headers and polite throttling. When Letterboxd responds with 403/429 or a challenge page, it falls back to a headless Chromium browser via Playwright. Parsers are written defensively with fallback selectors so small Letterboxd UI changes don't break them. Responses are cached to disk (1h TTL) to avoid hammering the site.

### 2. Taste matching (`src/lib/scoring/taste-match.ts`)
Compares your films against each friend's using weighted signals:

| Signal | Weight |
| --- | --- |
| Rating overlap | 0.30 |
| Genre overlap | 0.30 |
| List overlap | 0.15 |
| Review consistency | 0.10 |
| Recency | 0.15 |

### 3. Candidate generation (`src/lib/scoring/candidates.ts`)
Pulls films from your selected friends' watchlists, excludes ones you've already seen, and scores each by `friend match score × your custom weight`.

### 4. AI layer (`src/lib/ai/recommender.ts`)
Sends the top candidates to an OpenAI-compatible API for a one-line reason + "more like this" suggestions. Without an API key it uses deterministic reasons, so the app never depends on AI.

### 5. State (`src/hooks/useSession.ts`)
Everything persists in `sessionStorage` — username, selected friends, weights, genre, and results.

---

## 🛠 Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS 3** (custom dark cinematic theme)
- **cheerio** for HTML parsing
- **playwright** for stealth browser fallback
- **OpenAI-compatible API** for the optional AI layer

---

## 🚀 Getting started (local)

```bash
# 1. Install dependencies
npm install

# 2. Install the headless Chromium used by the crawler fallback
npm run setup:crawler

# 3. (Optional) enable the AI layer
cp .env.example .env.local   # then add your OPENAI_API_KEY

# 4. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a Letterboxd username, and pick your friends.

> **Note:** the first analyze can take a minute or two while it crawls profiles. Results are cached for 1 hour, so subsequent runs are fast.

---

## ⚙️ Configuration

All runtime knobs are environment-driven via `src/lib/config.ts`. Copy `.env.example` to `.env.local` and adjust as needed:

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | API key for the AI layer (optional). |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used for reasons / "more like this". |
| `CRAWLER_MODE` | `auto` | `auto` \| `http` \| `browser`. |
| `CRAWLER_MAX_PAGES` | `3` | Max pages crawled per profile. |
| `CRAWLER_DELAY_MS` | `500` | Polite delay between requests. |
| `CRAWLER_TIMEOUT_MS` | `20000` | Per-request timeout. |
| `CRAWLER_MAX_FILMS` | `200` | Max films considered per profile. |
| `CRAWLER_MAX_FRIENDS` | `20` | Max friends discovered. |
| `CACHE_DIR` | `.cache` | Crawl cache directory. |
| `CACHE_TTL_MS` | `3600000` | Cache lifetime (1h). |

---

## ☁️ Deploying to Vercel (free tier)

Friendboxd is optimized to run on Vercel's **Hobby (free) plan**.

### One-click deploy

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Framework preset: **Next.js** (auto-detected). Build command `npm run build`.
4. (Optional) Add the `OPENAI_API_KEY` environment variable.
5. **Deploy.** That's it.

### What the free-tier optimization does

- **HTTP-first crawling** — on Vercel the crawler defaults to `http` mode (no Playwright browser), which keeps the serverless bundle small and fast. The heavy Chromium fallback is only used when self-hosting.
- **Leaner crawl scope** — fewer pages, films, and friends are fetched per request to stay within the 60s function limit.
- **Ephemeral cache** — the crawl cache lives in `/tmp` (per-instance) instead of the repo, so warm instances serve cached results without writing to the read-only filesystem.
- **`maxDuration: 60`** — both API routes are configured for the maximum function duration allowed on the Hobby plan.

### ⚠️ Free-tier limitations (please read)

- **Auto-analyze may time out.** The full "find my friends + match taste" crawl can exceed 60s on a cold start, which is the Hobby plan's hard limit. When that happens, the app **gracefully falls back to manual friend entry** — just type your friends' usernames and everything else works. This is by design.
- **No persistent cache.** `/tmp` is wiped when instances spin down, so the first request after a cold start re-crawls. The 1h cache only helps warm instances.
- **Letterboxd may block you.** Scraping from a shared cloud IP is more likely to hit 403s than from your home connection. The app handles this with the manual-entry fallback, so it never fully breaks.
- **Playwright is not used on Vercel.** The stealth browser fallback is disabled there; it's only active when self-hosting.

### Self-hosting (Docker / VPS / Railway / Render)

```bash
npm install
npm run setup:crawler   # installs Chromium for the browser fallback
npm run build
npm run start
```

Or with Docker:

```dockerfile
FROM node:22-slim
RUN npx playwright install --with-deps chromium
WORKDIR /app
COPY . .
RUN npm ci && npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
```

---

## 📝 Notes & disclaimers

- **Not affiliated with Letterboxd.** Friendboxd is an independent fan project. "Letterboxd" is a trademark of Letterboxd Ltd. This project is not endorsed by or connected to Letterboxd in any way.
- **Public data only.** Friendboxd only reads *public* Letterboxd profiles, watchlists, and reviews. It never asks for or stores your Letterboxd password, and it cannot see private accounts.
- **Respect the site.** The crawler is deliberately polite — throttled, cached, and limited in scope — to minimize load on Letterboxd's servers. Please use it responsibly and don't hammer the site.
- **Your data stays in your browser.** All state (username, friends, weights, results) is stored in `sessionStorage` on your own device. Nothing is sent to any server except the Letterboxd pages the crawler fetches and (optionally) the AI provider you configure.
- **Recommendations are estimates.** Taste matching is a heuristic, not a science. Treat the output as suggestions, not gospel.
- **Crawling may break.** Letterboxd changes its markup and anti-bot measures over time. The parsers are written defensively, but if something breaks, the app degrades to manual friend entry rather than crashing.
- **AI content is generated.** If you enable the AI layer, reasons and "more like this" picks are generated by a language model and may occasionally be inaccurate.

---

## 📄 License

MIT — see [LICENSE](LICENSE) (add one if you plan to distribute).