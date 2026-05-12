FROM mcr.microsoft.com/playwright:v1.59.1-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    BOT_CHROME_PROFILE_DIR=/data/bot-profile

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc fluxbox dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY bot-login.ts ./
COPY frontend-vanilla ./frontend-vanilla
RUN npm run build

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data/bot-profile

EXPOSE 8001 5900

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
