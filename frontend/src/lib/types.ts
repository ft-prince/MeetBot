export interface User {
  id: string
  email: string
  name: string
  picture?: string
  autoJoinMinutes: number
}

export interface MeetingRow {
  id: string
  meeting_code: string
  title?: string | null
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  has_summary: boolean
}

export type ModuleStatus = 'ok' | 'partial' | 'failed' | 'skipped'

export interface ProcessingStatus {
  language?: ModuleStatus
  summary?: ModuleStatus
  actionItems?: ModuleStatus
  insights?: ModuleStatus
  chapters?: ModuleStatus
  speakers?: ModuleStatus
  questions?: ModuleStatus
}

export interface ActionItem {
  task: string
  owner: string | null
  dueHint: string | null
}

export interface Chapter {
  title: string
  startMs: number
  endMs: number
  summary: string
}

export interface SpeakerInsight {
  name: string
  contributions: string[]
  ownership: string[]
  collaboration: string[]
}

export interface MeetingSummary {
  id: string
  meetingCode: string
  title?: string
  summary: string | null
  keyInsights: string[]
  detailedRewrite: string | null
  importantPoints: string[]
  actionItems: ActionItem[]
  keyQuestions: string[]
  chapters: Chapter[]
  speakerInsights: SpeakerInsight[]
  processingStatus: ProcessingStatus
  language: string | null
  startedAt: string
  endedAt: string | null
  durationMs: number | null
}

export interface TranscriptSegment {
  id: string
  speaker_label: string | null
  speaker_name: string | null
  text: string
  start_ms: number
  end_ms: number
  confidence?: number
}

export interface ScheduledMeeting {
  id: string
  title: string
  meetingUrl: string
  scheduledFor: string
  description: string | null
  autoLaunch: boolean
  status: 'scheduled' | 'launched' | 'cancelled'
  meetingId: string | null
  createdAt: string
}

export interface ScheduleInput {
  title: string
  meetingUrl: string
  scheduledFor: string
  description?: string
  autoLaunch?: boolean
}

export interface CalendarEvent {
  id: string
  title: string
  meetUrl: string
  startTime: string
  endTime: string
  attendees: { name?: string; email?: string }[]
  autoJoin: boolean
  meetingId: string | null
}

export type SpeakerColor = { bg: string; text: string; border: string }

export interface WSMessage {
  type: 'transcript.interim' | 'transcript.final' | 'speaker.identified' | 'bot.joined' | 'bot.error' | 'meeting.ended'
  segmentId?: string
  speakerLabel?: string
  speakerName?: string
  text?: string
  startMs?: number
  label?: string
  name?: string
  error?: string
  /** DB UUID — present on meeting.ended */
  meetingId?: string
}

export interface LiveSegment {
  id: string
  speakerLabel: string | null
  speakerName: string | null
  text: string
  startMs: number
}