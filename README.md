# 🎬 Friendboxd

**Movie picks from your friends.**

Enter your Letterboxd username and Friendboxd quietly reads your friends' public watchlists, figures out whose taste is closest to yours, and serves up a personalized slate of recommendations — complete with synopses, taglines, directors, and runtimes pulled straight from Letterboxd.

> Built by [Mahesh](https://github.com/NMahesh20/Friendboxd) × AI

---
## 📝 Note

The datacenter IP where the website is hosted are blocked from accessing Letterboxd :( hence use the below docker way

```bash
docker pull oblivion2098/friendboxd:latest   # full (with stealth-browser fallback)
docker run --rm -d -p 3000:3000 oblivion2098/friendboxd:latest
```

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

## 📸 Screenshots

**1. Enter your Letterboxd username**

<img src="images/1.png" alt="Step 1 — Enter your Letterboxd username" width="700" />

**2. Pick your friends**

<img src="images/2.png" alt="Step 2 — Pick your friends" width="700" />

**3. Choose a genre or mood**

<img src="images/3.png" alt="Step 3 — Choose a genre or mood" width="700" />

**4. Get your picks**

<img src="images/4.png" alt="Step 4 — Get your picks" width="700" />

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
Fetches Letterboxd pages with realistic browser fingerprints (rotated User-Agent, matching `sec-ch-ua*` client hints, varied Accept-Language) and polite throttling. A **sliding-window rate limiter** caps requests at 2 per 10 seconds by default (tunable via `CRAWLER_RATE_MAX` / `CRAWLER_RATE_WINDOW_MS`). Supports optional HTTP proxy rotation via `PROXY_POOL` — when multiple proxies are configured, each retry rotates to a different one. When Letterboxd responds with 403/429 or a challenge page, it falls back to a headless Chromium browser via Playwright. Parsers are written defensively with fallback selectors so small Letterboxd UI changes don't break them. Responses are cached to disk (1h TTL) to avoid hammering the site.

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
| `CRAWLER_MAX_USER_PAGES` | `8` | Pages crawled for the user's own watchlist (exclusion set). |
| `CRAWLER_RATE_MAX` | `2` | Max requests per sliding window (rate limiter). |
| `CRAWLER_RATE_WINDOW_MS` | `10000` | Rate-limiter window length (10s). |
| `CRAWLER_POSTER_WAIT_MS` | `4000` | Max wait for lazy-loaded posters in the browser strategy (adaptive, capped). |
| `CRAWLER_BROWSER_SCROLL_DELAY_MS` | `120` | Delay between scroll steps when triggering lazy loading. |
| `CACHE_DIR` | `.cache` | Crawl cache directory. |
| `CACHE_TTL_MS` | `3600000` | Cache lifetime (1h). |
| `PROXY_POOL` | — | Comma-separated proxy URLs (`http://user:pass@host:port`). |
| `PROXY_MAX_TRIES` | `3` | Max different proxies tried per request when the pool has multiple. |

---

## ☁️ Deploying to Render

Friendboxd ships a `render.yaml` blueprint that deploys the Docker image as a **persistent web service** — no serverless timeouts, full Playwright browser support, and a writable filesystem.

### One-click deploy

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → **New** → **Blueprint** → connect the repo. `render.yaml` is auto-detected.
3. (Optional) Set `OPENAI_API_KEY` in the service's **Environment** tab.
4. **Deploy.** Render builds the Docker image and starts the service.

### What you get

- **No function timeouts** — it's a long-lived container, so the full "find my friends + match taste" crawl can take as long as it needs (no 60s serverless cap).
- **Full stealth-browser crawling** — Chromium ships in the image (`CRAWLER_MODE=auto`), so the browser fallback works when Letterboxd blocks plain HTTP.
- **Writable filesystem** — the crawl cache lives in `/tmp` (ephemeral). Add a Render Disk to persist it across restarts.
- **Lean standalone server** — the image runs `node server.js` (Next.js `output: 'standalone'`), not `next start`, so it fits the free tier's 512 MB memory comfortably.

### ⚠️ Notes

- **Free web services sleep** after ~15 min of inactivity and take ~50s to cold start. Upgrade `plan` in `render.yaml` to `starter` for an always-on instance.
- **Letterboxd may block you.** Scraping from a shared cloud IP is more likely to hit 403s than from your home connection. The app handles this with the manual-entry fallback, so it never fully breaks.
- **Cache is ephemeral.** `/tmp` is wiped on restart, so the first request after a restart re-crawls. The 1h cache only helps while the instance stays up.

### Self-hosting (Docker / VPS / Railway / Render)

```bash
npm install
npm run setup:crawler   # installs Chromium for the browser fallback
npm run build
npm run start
```

> **Note:** `npm run start` runs `next start`, which needs the full build and more memory. On memory-constrained hosts (e.g. Render's free tier, 512 MB), run the lean standalone server instead — it's what the Docker image uses:
> ```bash
> node .next/standalone/server.js
> ```

### 🐳 Docker (optimized)

The repo ships a multi-stage `Dockerfile` that uses Next.js `output: 'standalone'` — the runtime image contains **only the traced server + static assets** (no source, no dev dependencies). It runs as a non-root user and includes a healthcheck.

**Build & run (default — with the stealth-browser crawl fallback, ~1.7 GB):**

```bash
docker build -t friendboxd .
docker run --rm -p 3000:3000 friendboxd
```

**Lightweight HTTP-only variant (smaller, ~290 MB):**

```bash
docker build --build-arg INSTALL_BROWSER=0 -t friendboxd:light .
docker run --rm -p 3000:3000 -e CRAWLER_MODE=http friendboxd:light
```

**With the AI layer:**

```bash
docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-... friendboxd
```

**Or with Docker Compose:**

```bash
docker compose up --build
```

> **Note:** the default image ships Chromium and runs in `CRAWLER_MODE=auto`, so it can fall back to a stealth browser when Letterboxd blocks plain HTTP. For the lean HTTP-only image, build with `INSTALL_BROWSER=0` + `CRAWLER_MODE=http`. All env vars from the [Configuration](#-configuration) table can be passed with `-e`.

**Pull from Docker Hub:**

```bash
docker pull oblivion2098/friendboxd:latest   # full (with stealth-browser fallback)
docker run --rm -d -p 3000:3000 oblivion2098/friendboxd:latest
```

**Publish to Docker Hub (CI):**

The repo ships a GitHub Actions workflow (`.github/workflows/docker-publish.yml`) that builds **both** images and pushes them to Docker Hub on version tags plain `0.1.0`.

Tagging scheme:

| Image | Tags |
| --- | --- |
| Full (default, with browser) | `latest`, `full`, `<version>` on tags |
| Lightweight (HTTP-only) | `light`, `<version>-light` on tags |

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
