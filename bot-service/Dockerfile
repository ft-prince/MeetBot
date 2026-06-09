# ── NoteAI Bot Service ─────────────────────────────────────────────────────────
# Headless meeting bot with virtual display, virtual audio, and VNC debugging.
#
# Services started by entrypoint.sh:
#   Xvfb :99         — virtual X11 display (Chrome requires a display)
#   PulseAudio        — virtual audio device (WebRTC AudioContext needs real audio)
#   x11vnc :5900      — raw VNC for native client debugging
#   websockify :6080  — noVNC (browser-accessible VNC at http://host:6080/vnc.html)
#   Playwright Chrome — joins the meeting and streams PCM back to the backend
#
# Build:
#   docker build -t noteai-bot -f bot-service/Dockerfile .
#
# Run:
#   docker run --rm --network=host \
#     -e MEETING_URL=https://meet.google.com/abc-defg-hij \
#     -e BACKEND_WS=ws://localhost:8001/audio?meetingId=abc-defg-hij \
#     noteai-bot

FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV PULSE_SERVER=unix:/tmp/pulse/native

# ── System packages ────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual display
    xvfb \
    # Virtual audio
    pulseaudio \
    pulseaudio-utils \
    # VNC + browser VNC
    x11vnc \
    websockify \
    novnc \
    # Chrome dependencies
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    # Required by Chrome 116+ for GPU buffer allocation
    libgbm1 \
    libvulkan1 \
    mesa-vulkan-drivers \
    # Node.js build tools
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 LTS ─────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Google Chrome stable ───────────────────────────────────────────────────────
# Use system Chrome so it matches the version Playwright expects with channel:'chrome'.
RUN wget -q -O /tmp/chrome.deb \
    https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# ── App source ─────────────────────────────────────────────────────────────────
WORKDIR /app

# Copy only what the bot service needs:
#   backend/src/bot/   — audio injectors (read at runtime, not transpiled)
#   bot-service/       — TypeScript source
COPY backend/src/bot/audioInjector.js      ./backend/src/bot/
COPY backend/src/bot/teamsAudioInjector.js ./backend/src/bot/
COPY backend/src/bot/zoomAudioInjector.js  ./backend/src/bot/
COPY bot-service/package.json              ./bot-service/
COPY bot-service/tsconfig.json             ./bot-service/
COPY bot-service/src/                      ./bot-service/src/

# Install dependencies and build
WORKDIR /app/bot-service
RUN npm install --omit=dev
RUN npm install typescript tsx --save-dev
RUN npx tsc

# Playwright uses the installed system Chrome (channel: 'chrome' in launch opts).
# Tell it where Chrome lives so it doesn't try to download its own Chromium.
ENV CHROMIUM_PATH=/usr/bin/google-chrome-stable

# ── PulseAudio config ──────────────────────────────────────────────────────────
RUN mkdir -p /etc/pulse
COPY bot-service/pulse/default.pa /etc/pulse/default.pa

# ── Entrypoint ─────────────────────────────────────────────────────────────────
COPY bot-service/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# VNC port (raw)            5900
# noVNC / browser VNC port  6080
EXPOSE 5900 6080

ENTRYPOINT ["/entrypoint.sh"]
