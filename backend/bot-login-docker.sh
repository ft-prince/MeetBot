#!/usr/bin/env bash
# One-time interactive login for the dockerized bot.
# Spins up the container with VNC enabled, runs bot-login.ts, and waits
# for you to sign in to Google via any VNC client on localhost:5900.
set -e

cd "$(dirname "$0")"

echo "[login] Building image if needed..."
docker compose build backend

echo
echo "[login] Starting login container with VNC on :5900"
echo "[login] Connect a VNC client to localhost:5900 (password: noteai)"
echo "[login] Sign in to Google in the Chrome window, then close it."
echo

ENABLE_VNC=1 docker compose run --rm \
  --service-ports \
  -e ENABLE_VNC=1 \
  backend \
  npx tsx bot-login.ts

echo
echo "[login] Done. Profile saved to the 'bot-profile' Docker volume."
echo "[login] Start the bot with: docker compose up -d backend"
