-- NoteAI Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- One row per Google Meet session
CREATE TABLE IF NOT EXISTS meetings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_code  TEXT NOT NULL,           -- e.g. "abc-defg-hij"
  title         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  duration_ms   INTEGER,
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_meetings_code ON meetings(meeting_code);
CREATE INDEX IF NOT EXISTS idx_meetings_started ON meetings(started_at DESC);

-- Speaker identity within a meeting
-- SPEAKER_0, SPEAKER_1 labels mapped to real names (from DOM)
CREATE TABLE IF NOT EXISTS speakers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  diarization_label TEXT NOT NULL,       -- "SPEAKER_0", "SPEAKER_1", etc.
  display_name  TEXT,                    -- "John Smith" from Meet DOM
  confirmed     BOOLEAN DEFAULT false,   -- true once DOM-matched
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(meeting_id, diarization_label)
);

CREATE INDEX IF NOT EXISTS idx_speakers_meeting ON speakers(meeting_id);

-- One row per finalized transcript segment
CREATE TABLE IF NOT EXISTS transcript_segments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_id    UUID REFERENCES speakers(id),
  speaker_label TEXT,                    -- diarization label (SPEAKER_0)
  speaker_name  TEXT,                    -- resolved name, nullable until identified
  text          TEXT NOT NULL,
  start_ms      INTEGER NOT NULL,        -- ms from meeting start
  end_ms        INTEGER NOT NULL,
  confidence    FLOAT,
  word_data     JSONB,                   -- [{word, start_ms, end_ms, confidence}]
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_segments_search ON transcript_segments USING GIN (to_tsvector('english', text));

-- DOM speaker event log (raw events from content.js)
-- Used for correlation with diarization labels
CREATE TABLE IF NOT EXISTS dom_speaker_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_name  TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('start', 'end')),
  event_ms      BIGINT NOT NULL,         -- epoch ms
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dom_events_meeting ON dom_speaker_events(meeting_id, event_ms);
