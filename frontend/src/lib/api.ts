import type { CalendarEvent, MeetingRow, MeetingSummary, TranscriptSegment, User } from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  // Auth
  me: () => req<{ user: User | null }>('/auth/me').catch(() => ({ user: null })),
  logout: () => fetch('/auth/logout', { method: 'POST', credentials: 'include' }),
  updateSettings: (autoJoinMinutes: number) =>
    req<{ ok: true }>('/auth/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoJoinMinutes }),
    }),

  // Meetings
  listMeetings: () => req<{ meetings: MeetingRow[] }>('/api/meetings'),
  getTranscript: (id: string) => req<{ segments: TranscriptSegment[] }>(`/api/meetings/${id}/transcript`),
  getSummary: (id: string) => req<MeetingSummary>(`/api/meetings/${id}/summary`),
  joinMeeting: (meetingUrl: string) =>
    req<{ meetingId: string }>('/api/meetings/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingUrl }),
    }),
  // code = meeting code like "abc-defg-hij"
  stopMeeting: (code: string) =>
    fetch(`/api/meetings/${code}/stop`, { method: 'POST', credentials: 'include' }),
  exitMeeting: (code: string) =>
    fetch(`/api/meetings/${code}/exit`, { method: 'POST', credentials: 'include' }),
  activeBots: () => req<{ active: string[] }>('/api/bots/active'),

  // Calendar
  listEvents: () => req<{ events: CalendarEvent[] }>('/api/calendar/events'),
  syncCalendar: () => req<{ synced: number; events: CalendarEvent[] }>('/api/calendar/sync', { method: 'POST' }),
  setAutoJoin: (eventId: string, autoJoin: boolean) =>
    req<{ ok: true }>(`/api/calendar/events/${eventId}/auto-join`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoJoin }),
    }),
}
