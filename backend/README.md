# NoteAI — Google Meet Transcription with Speaker Identification

## How it works

```
Google Meet tab
  └── content.js        → watches DOM for who is speaking (name + timestamp)
  └── background.js     → captures tab audio → streams PCM to backend
  └── audio-worklet.js  → converts Float32 audio to 16kHz Int16 PCM

Backend (Node.js)
  └── /audio WebSocket  → receives PCM, forwards to Deepgram
  └── Deepgram          → returns transcript + diarization (SPEAKER_0, SPEAKER_1)
  └── SpeakerCorrelator → matches SPEAKER_0 to "John" using DOM timestamps
  └── /panel WebSocket  → streams labeled transcript to side panel

Side panel (panel.html)
  └── Shows: [00:12] John: "Let's discuss the roadmap"
```

## Setup

### 1. Get a Deepgram API key
- Sign up at https://deepgram.com (free tier available)
- Copy your API key

### 2. Start the backend

```bash
cd backend
cp .env.example .env
# Edit .env and add your DEEPGRAM_API_KEY
# DATABASE_URL is optional for initial testing

npm install
npm run dev
```

Backend starts on `http://localhost:3001`

### 3. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 4. Use it

1. Go to `https://meet.google.com` and join/start a meeting
2. Click the NoteAI extension icon → side panel opens
3. Recording starts automatically
4. Watch the transcript appear with speaker names in real time

## Project structure

```
noteAI/
├── extension/
│   ├── manifest.json       Chrome MV3 manifest
│   ├── background.js       Service worker — audio capture + WS relay
│   ├── content.js          DOM observer — detects who is speaking
│   ├── audio-worklet.js    Audio processing (Float32 → PCM)
│   ├── panel.html          Side panel UI
│   └── panel.js            Side panel logic
│
└── backend/
    ├── src/
    │   ├── index.ts                    Entry point
    │   ├── config.ts                   Env config
    │   ├── ws/
    │   │   ├── ingestHandler.ts        WebSocket session manager
    │   │   └── deepgramClient.ts       Deepgram streaming client
    │   ├── services/
    │   │   ├── speakerCorrelator.ts    Core speaker ID algorithm
    │   │   └── meetingService.ts       DB operations
    │   ├── db/
    │   │   ├── client.ts               PostgreSQL pool
    │   │   └── schema.sql              DB schema
    │   └── routes/
    │       └── api.ts                  REST API
    └── .env
```

## Without a database

The backend works without PostgreSQL — transcripts won't persist but everything else (live captions, speaker identification) works fine. Just leave `DATABASE_URL` blank or unset.

## REST API

```
GET /api/health
GET /api/meetings
GET /api/meetings/:id/transcript
```
