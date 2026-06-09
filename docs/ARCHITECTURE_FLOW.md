# NoteAI — Architecture & Data Flow

Ports, applications, and how audio/transcripts/summaries move between them.

## Port map

| Port | Application | Protocol | Role |
|------|-------------|----------|------|
| 5173 | Frontend (Vite/React) | HTTP + WS | UI; proxies `/api`, `/auth`, `/panel` → 8001 |
| 8001 | Backend (Express + ws) | HTTP + WS | REST API, `/audio` ingest, `/panel` live stream, bot orchestration |
| 3003 | AIKosh sidecar (Python) | WS | **In-house Indic STT** (IndicConformer-600M, MPS) — default |
| 3002 | WhisperX sidecar (Python) | WS | Alt local STT (optional) |
| 5432 | PostgreSQL | TCP | Meetings, transcript_segments, speakers, summaries |
| ☁️   | Deepgram | WSS | Cloud STT (dormant — only if `STT_ENGINE=deepgram`) |
| ☁️   | Groq | HTTPS | LLM summary/insights pipeline (post-meeting) |

## Flow

```mermaid
flowchart TD
    subgraph Meetings["Meeting platforms (browser, Playwright bots)"]
        MEET["Google Meet bot<br/>meetBot.ts"]
        ZOOM["Zoom bot<br/>zoomBot.ts ✅"]
        TEAMS["Teams bot<br/>teamsBot.ts (later)"]
    end

    subgraph Backend["Backend — Express + ws : 8001"]
        BM["botManager.launch / stop"]
        ING["ingestHandler<br/>WS /audio?meetingId="]
        FAC{"createSttClient()<br/>STT_ENGINE switch"}
        CORR["SpeakerCorrelator<br/>(per-track + DOM name)"]
        PANEL["WS /panel?meetingId=<br/>(live transcript broadcast)"]
        PIPE["AI summary pipeline<br/>aiPipelineService.ts"]
    end

    subgraph STT["Speech-to-text engines"]
        AIK["AIKosh sidecar : 3003<br/>IndicConformer (in-house) ◄ default"]
        WX["WhisperX sidecar : 3002<br/>(optional)"]
        DG["Deepgram ☁️ (dormant)"]
    end

    DB[("PostgreSQL : 5432<br/>transcript_segments, meetings")]
    GROQ["Groq ☁️ LLM"]

    subgraph Frontend["Frontend — Vite : 5173"]
        LIVE["/live (real-time)"]
        DETAIL["/meetings/:id (transcript + summary)"]
    end

    USER(["User browser"])

    %% Control: launch
    USER -->|"Start Recording → POST /api/meetings/join"| BM
    BM -->|spawn + join| MEET
    BM -->|spawn + join| ZOOM
    BM -.->|spawn + join| TEAMS

    %% Audio capture → ingest (per-participant Int16 PCM @16kHz)
    MEET -->|"track audio (PCM) → WS /audio :8001"| ING
    ZOOM -->|"track audio (PCM) → WS /audio :8001"| ING
    TEAMS -.->|"track audio (PCM)"| ING

    %% STT routing
    ING --> FAC
    FAC -->|"STT_ENGINE=aikosh (default)<br/>WS :3003"| AIK
    FAC -->|"STT_ENGINE=whisper<br/>WS :3002"| WX
    FAC -.->|"STT_ENGINE=deepgram<br/>WSS cloud"| DG

    %% Transcripts back
    AIK -->|"transcript JSON<br/>{text,start_ms,end_ms}"| CORR
    WX -->|transcript JSON| CORR
    DG -.->|transcript JSON| CORR

    %% Persist + live
    CORR -->|saveSegment| DB
    CORR -->|broadcast| PANEL
    PANEL -->|"WS /panel (proxied via :5173)"| LIVE

    %% Stop → summary
    USER -->|"Stop → POST /api/meetings/:code/stop"| BM
    BM -->|endBotSession| PIPE
    PIPE -->|transcript in| DB
    PIPE -->|"summarize/insights"| GROQ
    GROQ -->|JSON results| PIPE
    PIPE -->|savePipelineResults| DB

    %% Read in UI
    DETAIL -->|"GET /api/meetings/:id/transcript+summary (proxied :5173→:8001)"| DB
```

## One-line summary of the audio path (default, in-house)

```
Browser bot → PCM @16kHz → ws://localhost:8001/audio
   → ingestHandler → createSttClient(aikosh) → ws://localhost:3003 (IndicConformer)
   → transcript JSON → SpeakerCorrelator → Postgres :5432
   → /panel WS → Frontend :5173 (live)
On stop → AI pipeline → Groq ☁️ → summary → Postgres → /meetings/:id
```

Transcription is **fully on-device** (no Deepgram, no external API). Only the
post-meeting summary uses Groq.
