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

-- Subscription plan + admin flag. Limits for each plan live in
-- src/services/planService.ts (PLANS), not in the database — they change with a
-- deploy, and usage is counted from `meetings` so it can't drift.
-- plan_until NULL on a paid plan = no expiry; a past date degrades to free.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan       TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin   BOOLEAN NOT NULL DEFAULT false;

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
-- Post-meeting delivery + unread-reminder tracking
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS viewed_at             TIMESTAMPTZ; -- first time the owner opened it in the dashboard
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary_email_sent_at TIMESTAMPTZ; -- post-meeting results email delivered
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_sent_at      TIMESTAMPTZ; -- unread-meeting reminder delivered

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

-- ── Email Threads ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_threads (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_thread_id  TEXT NOT NULL,
  subject          TEXT NOT NULL DEFAULT '',
  snippet          TEXT,
  participants     JSONB DEFAULT '[]',
  label_ids        JSONB DEFAULT '[]',
  message_count    INTEGER DEFAULT 0,
  last_message_at  TIMESTAMPTZ,
  first_message_at TIMESTAMPTZ,
  is_unread        BOOLEAN DEFAULT false,
  project_tag      TEXT,
  synced_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, gmail_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_email_threads_user      ON email_threads(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_threads_project    ON email_threads(user_id, project_tag);
CREATE INDEX IF NOT EXISTS idx_email_threads_subject    ON email_threads USING GIN (to_tsvector('english', subject));

-- ── Emails (individual messages within threads) ─────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id        UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  from_address     TEXT NOT NULL,
  from_name        TEXT,
  to_addresses     JSONB DEFAULT '[]',
  cc_addresses     JSONB DEFAULT '[]',
  subject          TEXT,
  body_text        TEXT,
  body_html        TEXT,
  sent_at          TIMESTAMPTZ NOT NULL,
  is_sent_by_user  BOOLEAN DEFAULT false,
  has_attachments  BOOLEAN DEFAULT false,
  synced_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_emails_thread   ON emails(thread_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_emails_user     ON emails(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_body     ON emails USING GIN (to_tsvector('english', body_text));

-- ── Email Thread Analysis (AI-generated) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_analysis (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id        UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE UNIQUE,
  summary          TEXT,
  status           TEXT,
  key_points       JSONB DEFAULT '[]',
  decisions        JSONB DEFAULT '[]',
  risks            JSONB DEFAULT '[]',
  sentiment        TEXT,
  follow_up_needed BOOLEAN DEFAULT false,
  follow_up_reason TEXT,
  suggested_reply  TEXT,
  next_action      TEXT,
  analyzed_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_analysis_thread ON email_analysis(thread_id);

-- ── Email Action Items ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_action_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id        UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task             TEXT NOT NULL,
  owner            TEXT,
  due_hint         TEXT,
  priority         TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status           TEXT DEFAULT 'open' CHECK (status IN ('open', 'completed', 'dismissed')),
  source           TEXT DEFAULT 'ai',
  created_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_actions_thread ON email_action_items(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_actions_user   ON email_action_items(user_id, status);

-- ── Email Follow-Ups ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_follow_ups (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id        UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason           TEXT NOT NULL,
  due_date         DATE,
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'snoozed', 'dismissed')),
  suggested_message TEXT,
  days_waiting     INTEGER,
  created_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_followups_user   ON email_follow_ups(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_email_followups_thread ON email_follow_ups(thread_id);

-- ── Email Sync State ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_sync_state (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  last_history_id  TEXT,
  last_sync_at     TIMESTAMPTZ,
  total_synced     INTEGER DEFAULT 0,
  sync_status      TEXT DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  error_message    TEXT
);

-- How far back Gmail is fetched, and (by default) how far back threads are sent
-- for AI analysis. Older threads stay in the DB as searchable metadata but are
-- not auto-analyzed — see analyzeUnanalyzedThreads().
ALTER TABLE email_sync_state ADD COLUMN IF NOT EXISTS sync_days INTEGER DEFAULT 30;
