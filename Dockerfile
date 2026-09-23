# syntax=docker/dockerfile:1

# ─── Friendboxd — optimized lightweight Docker image ────────────────────
# Multi-stage build using Next.js `output: 'standalone'`: the runtime image
# ships only the traced server + static assets (no source, no dev deps).
#
# Build (default — with the stealth-browser crawl fallback, ~1.7 GB):
#   docker build -t friendboxd .
#
# Build the lightweight HTTP-only variant (smaller, ~290 MB):
#   docker build --build-arg INSTALL_BROWSER=0 -t friendboxd:light .
#
# Run:
#   docker run --rm -p 3000:3000 friendboxd
#   # with the AI layer:
#   docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-... friendboxd

# ── Stage 1: dependencies ───────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
# Skip the Playwright browser download during npm ci — browsers are only
# installed in the runtime stage when INSTALL_BROWSER=1.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Copy manifests first for Docker layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ──────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Emits .next/standalone (minimal server) + .next/static.
RUN npm run build

# ── Stage 3: runtime ────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

# OCI container labels (shown on Docker Hub).
LABEL org.opencontainers.image.title="Friendboxd"
LABEL org.opencontainers.image.description="Movie picks from your friends' Letterboxd watchlists — taste-matched, genre-filtered recommendations with an optional AI layer."
LABEL org.opencontainers.image.source="https://github.com/NMahesh20/Friendboxd"
LABEL org.opencontainers.image.url="https://github.com/NMahesh20/Friendboxd"
LABEL my.custom.namespace.icon="https://raw.githubusercontent.com/NMahesh20/Friendboxd/refs/heads/main/images/icon.png"

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    # Stealth-browser crawling by default (Chromium ships in the image).
    # Set to `http` for HTTP-only (lightweight) or `browser` to force it.
    CRAWLER_MODE=auto \
    # Polite rate limit: max requests per sliding window (default 2 per 10s).
    CRAWLER_RATE_MAX=2 \
    CRAWLER_RATE_WINDOW_MS=10000 \
    # Browser-fingerprint identity: UA + Client Hints + TLS profile all use
    # this impersonation target (chrome131 ships with curl-impersonate v2.2).
    # CRAWLER_IMPERSONATE=chrome131 \
    # Use the bundled curl-impersonate binary for TLS impersonation.
    CRAWLER_TLS_IMPERSONATION=auto \
    # Ephemeral, writable cache (the repo .cache is not present here).
    CACHE_DIR=/tmp/friendboxd-cache \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy the minimal standalone server + static assets.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Install Chromium for the stealth-browser crawl fallback (default ON).
# Set INSTALL_BROWSER=0 for the lightweight HTTP-only image.
# Playwright is installed fresh here because the standalone traced
# node_modules doesn't expose the npx CLI correctly.
ARG INSTALL_BROWSER=1
RUN if [ "$INSTALL_BROWSER" = "1" ]; then \
      npm install --no-save playwright && \
      npx playwright install --with-deps chromium && \
      chmod -R a+rX /ms-playwright; \
    fi

# Bundle curl-impersonate (default ON): a patched curl whose TLS ClientHello
# and HTTP2 fingerprint are byte-compatible with real Chrome. It is the exact
# engine the Python `curl_cffi` module wraps, and it's what gets the crawler
# past Letterboxd's header/TLS fingerprinting from datacenter IPs — plain
# Node/OpenSSL TLS is trivially distinguishable. ~22 MB; set
# INSTALL_CURL_IMPERSONATE=0 for the leanest possible image.
ARG INSTALL_CURL_IMPERSONATE=1
RUN if [ "$INSTALL_CURL_IMPERSONATE" = "1" ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends curl ca-certificates && \
      curl -fsSL -o /tmp/curl-impersonate.tar.gz \
        https://github.com/lexiforest/curl-impersonate/releases/download/v2.2.3/curl-impersonate-v2.2.3.x86_64-linux-gnu.tar.gz && \
      tar -xzf /tmp/curl-impersonate.tar.gz -C /usr/local/bin \
        curl-impersonate curl_chrome131 && \
      chmod +x /usr/local/bin/curl-impersonate /usr/local/bin/curl_chrome131 && \
      rm /tmp/curl-impersonate.tar.gz; \
    fi

# Run as a non-root user.
USER node

EXPOSE 3000

HEALTHCHECK --interval=120s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]