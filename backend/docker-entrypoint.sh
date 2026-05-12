#!/usr/bin/env bash
set -e

# Virtual display for headful Chrome (Meet detects pure headless aggressively).
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
sleep 0.5

# Lightweight WM so Chrome has a frame to attach to.
fluxbox >/dev/null 2>&1 &

# Optional: x11vnc on :5900 for remote viewing / one-time Google login.
# Enable by setting ENABLE_VNC=1. Default password "noteai" — override with VNC_PASSWORD.
if [ "${ENABLE_VNC:-0}" = "1" ]; then
  PW="${VNC_PASSWORD:-noteai}"
  mkdir -p /root/.vnc
  x11vnc -storepasswd "$PW" /root/.vnc/passwd >/dev/null
  x11vnc -display :99 -forever -shared -rfbauth /root/.vnc/passwd -rfbport 5900 -quiet &
  echo "[entrypoint] VNC enabled on :5900 (password: $PW)"
fi

exec "$@"
