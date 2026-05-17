-- NoteAI Database Schema (idempotent — safe to re-run)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users (Google OAuth) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_id        TEXT UNIQUE NOT NULL,
  email            TEXT NOT NULL,
  name             TEXT NOT NULL,
  picture          TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expiry     TIMESTAMPTZ,
  auto_join_minutes INTEGER DEFAULT 2,   -- join N minutes before meeting starts
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Sessions (connect-pg-simple) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session (
  sid     TEXT PRIMARY KEY,
  sess    JSON NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

-- ── Meetings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_code     TEXT NOT NULL,
  title            TEXT,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  calendar_event_id TEXT,              -- Google Calendar event ID
  scheduled_start  TIMESTAMPTZ,       -- when meeting was supposed to start
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  duration_ms      INTEGER,
  summary          TEXT,              -- AI-generated summary
  key_insights     JSONB DEFAULT '[]', -- AI-generated bullet points
  metadata         JSONB DEFAULT '{}', -- rich pipeline outputs (rewrite, action_items, chapters, etc.)
  processing_status JSONB DEFAULT '{}',-- per-module status: { summary:'ok', actionItems:'failed', ... }
  language         TEXT                 -- detected language code (e.g. 'en', 'hi', 'hi-en')
);

-- Idempotent column adds for existing installations
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS processing_status JSONB DEFAULT '{}';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS language TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_code    ON meetings(meeting_code);
CREATE INDEX IF NOT EXISTS idx_meetings_started ON meetings(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_user    ON meetings(user_id);

-- ── Calendar Events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_event_id  TEXT NOT NULL,
  title            TEXT NOT NULL,
  meet_url         TEXT NOT NULL,
  start_time       TIMESTAMPTZ NOT NULL,
  end_time         TIMESTAMPTZ NOT NULL,
  attendees        JSONB DEFAULT '[]',
  auto_join        BOOLEAN DEFAULT false,
  meeting_id       UUID REFERENCES meetings(id) ON DELETE SET NULL,
  synced_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_user_time ON calendar_events(user_id, start_time);

-- ── Scheduled Meetings (user-created via "Schedule Meeting") ──────────────────
-- Separate from `meetings` so we don't pollute that table with rows that have no
-- recording. When the bot launches (auto or manual), a row is inserted into
-- `meetings` and linked back here via `meeting_id`.
CREATE TABLE IF NOT EXISTS scheduled_meetings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  meeting_url     TEXT NOT NULL,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  description     TEXT,
  auto_launch     BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'launched', 'cancelled')),
  meeting_id      UUID REFERENCES meetings(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_user_time ON scheduled_meetings(user_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_status    ON scheduled_meetings(status, scheduled_for);

-- ── Speakers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS speakers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id        UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  diarization_label TEXT NOT NULL,
  display_name      TEXT,
  confirmed         BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(meeting_id, diarization_label)
);

CREATE INDEX IF NOT EXISTS idx_speakers_meeting ON speakers(meeting_id);

-- ── Transcript Segments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcript_segments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_id    UUID REFERENCES speakers(id),
  speaker_label TEXT,
  speaker_name  TEXT,
  text          TEXT NOT NULL,
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  confidence    FLOAT,
  word_data     JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_segments_search  ON transcript_segments
  USING GIN (to_tsvector('english', text));

-- ── DOM Speaker Events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dom_speaker_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_name  TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('start', 'end')),
  event_ms      BIGINT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dom_events_meeting ON dom_speaker_events(meeting_id, event_ms);