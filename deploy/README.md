# Deploying noteAI / MeetMaster to AWS — meet.nexren.ai

Everything here was tested end-to-end on an ARM (arm64) machine — same CPU family
as the AWS Graviton instances (t4g / m6g). One server runs three containers:

| Container     | What it does                                                         |
|---------------|----------------------------------------------------------------------|
| `app`         | Backend + React UI + meeting bots (Chrome on a virtual display)      |
| `db`          | Postgres 16 — schema is created automatically on first start         |
| `cloudflared` | Cloudflare Tunnel — publishes the app as `meet.nexren.ai`            |

No web ports are opened on the server: the tunnel connects **out** to Cloudflare.
Only SSH (22) needs to be allowed in the security group.

## Server
- **Dedicated instance — not the Renata/enmon server** (bots run Chrome and are memory-hungry).
- Ubuntu 22.04 or 24.04, arm64 (`t4g.medium`, 2 vCPU / 4 GB ≈ 2–3 simultaneous meetings) or amd64.
- 30 GB disk, Elastic IP (a stable IP keeps the bot's Google login trusted).

## 1. Install Docker (once)
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
```

## 2. Get the code and configure
```bash
git clone <repo-url> noteAI && cd noteAI/deploy
cp .env.example .env && chmod 600 .env
nano .env        # fill every empty value (see comments inside)
```

## 3. Point the tunnel at the server
Cloudflare dashboard → Zero Trust → Networks → Tunnels → the tunnel for `meet.nexren.ai`:
- Copy its **token** into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
- Public hostname `meet.nexren.ai` → service **`http://localhost:8001`**.
- Stop `cloudflared` anywhere else (e.g. a laptop) so it doesn't serve old code.

## 4. Start
```bash
docker compose --profile tunnel up -d --build
docker compose logs -f app      # expect: Database connected, Serving frontend, [smtp] Login OK
```

## 5. Sign the bot into Google (once, on the server)
Do this on the server itself — a profile copied from a laptop is usually rejected
by Google on a new machine/IP. Use a dedicated bot account.
```bash
docker compose stop app
docker compose run --rm --service-ports -e ENABLE_VNC=1 app npx tsx bot-login.ts
```
From your laptop, in another terminal, tunnel VNC over SSH and connect:
```bash
ssh -i <key> -L 5900:127.0.0.1:5900 ubuntu@<server-ip>
```
Open `vnc://localhost:5900` (macOS Finder → Go → Connect to Server), password `noteai`,
sign in to Google in the Chrome window, then press ENTER in the server terminal.
```bash
docker compose --profile tunnel up -d
```
The login lives in the `bot-profiles` volume and survives rebuilds/redeploys.
The app re-checks it every 12 h and emails `SUPPORT_EMAIL` if the bot is ever logged out.
Zoom/Teams logins: same command with `scripts/zoom-login.ts` / `scripts/teams-login.ts`.

## Verify
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://meet.nexren.ai/          # 200
curl -s -o /dev/null -w "%{http_code}\n" https://meet.nexren.ai/auth/me   # 401 (logged out = OK)
```
Then log in at https://meet.nexren.ai and send the bot into a test meeting.

## Update to a new version
```bash
cd noteAI && git pull && cd deploy && docker compose --profile tunnel up -d --build
```

## Backup the database
```bash
docker compose exec -T db pg_dump -U noteai noteai | gzip > noteai-$(date +%F).sql.gz
```
