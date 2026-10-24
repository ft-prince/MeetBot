# noteAI / MeetMaster — production image (backend + React UI + in-house meeting bots)
# Build context is the REPO ROOT:  docker compose -f deploy/docker-compose.yml build
# Multi-arch: works on AWS Graviton (arm64, e.g. t4g/m6g) and x86 (amd64).

# ── 1. React frontend ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── 2. Backend + bots ─────────────────────────────────────────────────────────
# Playwright base image = all of Chrome's system libraries; version must match
# the playwright npm package (backend/package.json).
FROM mcr.microsoft.com/playwright:v1.59.1-jammy
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    NODE_ENV=production

# Virtual display for the bots + optional VNC for the one-time bot login, and
# real Google Chrome (the bots launch channel:'chrome'; the base image only ships
# Chromium). Google publishes Chrome for both amd64 and arm64.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc fluxbox dbus-x11 wget ca-certificates \
 && wget -q -O /tmp/chrome.deb \
      "https://dl.google.com/linux/direct/google-chrome-stable_current_${TARGETARCH}.deb" \
 && apt-get install -y /tmp/chrome.deb \
 && rm -f /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
# Full install (incl. dev deps): tsc builds the app and tsx runs bot-login.ts.
RUN npm ci --include=dev
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/bot-login.ts ./
COPY backend/frontend-vanilla ./frontend-vanilla
RUN npm run build

# The backend serves the UI from ../../frontend/dist relative to dist/ → /frontend/dist
COPY --from=frontend /frontend/dist /frontend/dist

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# All bot logins (Meet, Zoom, Teams) live under /root/.noteai — mount a volume there.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /root/.noteai

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8001/ || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
