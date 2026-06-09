#!/bin/bash
set -e

# ── Virtual display ────────────────────────────────────────────────────────────
Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Wait until Xvfb creates its lock file (indicates it's accepting connections)
until [ -f /tmp/.X99-lock ]; do sleep 0.1; done
echo "[entrypoint] Xvfb started (pid $XVFB_PID)"

# ── PulseAudio virtual audio ───────────────────────────────────────────────────
mkdir -p /tmp/pulse
pulseaudio \
  --start \
  --exit-idle-time=-1 \
  --daemon \
  --disallow-exit \
  --system=false \
  --log-target=stderr \
  2>&1 | sed 's/^/[pulse] /' &

# Wait until PulseAudio socket appears (max 10 s)
for i in $(seq 1 50); do
  [ -S /tmp/pulse/native ] && break
  sleep 0.2
done
echo "[entrypoint] PulseAudio started"

# Load a null sink so Chrome WebRTC has an audio output device
pactl load-module module-null-sink sink_name=VirtualSink sink_properties=device.description=VirtualSink 2>/dev/null || true
pactl set-default-sink VirtualSink 2>/dev/null || true
echo "[entrypoint] PulseAudio virtual sink ready"

# ── VNC server (raw) ───────────────────────────────────────────────────────────
x11vnc -display :99 -nopw -listen localhost -rfbport 5900 -forever -shared -bg -quiet
echo "[entrypoint] x11vnc listening on :5900"

# ── noVNC / browser VNC ────────────────────────────────────────────────────────
# websockify bridges the raw TCP VNC on 5900 to a WebSocket on 6080.
# noVNC ships a static file server; point browser to http://host:6080/vnc.html
NOVNC_DIR=$(find /usr/share -maxdepth 2 -name "novnc" -type d 2>/dev/null | head -1)
if [ -z "$NOVNC_DIR" ]; then
  NOVNC_DIR="/usr/share/novnc"
fi

websockify --web="$NOVNC_DIR" 6080 localhost:5900 &
echo "[entrypoint] noVNC listening on :6080 (web dir: $NOVNC_DIR)"

# ── Bot ────────────────────────────────────────────────────────────────────────
echo "[entrypoint] Starting bot — MEETING_URL=${MEETING_URL}"
exec node /app/bot-service/dist/index.js
