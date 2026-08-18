import type {
  CalendarEvent, MeetingRow, MeetingSummary, ScheduledMeeting, ScheduleInput, TranscriptSegment, User,
  EmailThread, EmailMessage, EmailAnalysis, EmailActionItem, EmailFollowUp, EmailSyncState, EmailDailyBrief,
  AnalysisProgress, AdminStats, AdminUser, AdminTimeseries, AdminUserDetail, PlanId,
} from './types'

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

  // Account — export is a plain <a href> so the browser downloads it
  deleteAccount: () => req<{ ok: true }>('/api/account', { method: 'DELETE' }),

  // Admin (403 unless users.is_admin)
  adminStats: () => req<AdminStats>('/api/admin/stats'),
  adminUsers: (q = '') => req<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
  adminTimeseries: (days = 30) => req<AdminTimeseries>(`/api/admin/timeseries?days=${days}`),
  adminUser: (id: string) => req<AdminUserDetail>(`/api/admin/users/${id}`),
  adminSetPlan: (id: string, plan: PlanId, planUntil?: string | null) =>
    req<{ ok: true }>(`/api/admin/users/${id}/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, planUntil: planUntil || null }),
    }),

  // Meetings
  listMeetings: () => req<{ meetings: MeetingRow[] }>('/api/meetings'),
  getTranscript: (id: string) => req<{ segments: TranscriptSegment[] }>(`/api/meetings/${id}/transcript`),
  getSummary: (id: string) => req<MeetingSummary>(`/api/meetings/${id}/summary`),
  joinMeeting: (meetingUrl: string, title?: string) =>
    req<{ meetingId: string }>('/api/meetings/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingUrl, title }),
    }),
  updateMeetingTitle: (id: string, title: string) =>
    req<{ title: string }>(`/api/meetings/${id}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  stopMeeting: (code: string) =>
    fetch(`/api/meetings/${code}/stop`, { method: 'POST', credentials: 'include' }),
  exitMeeting: (code: string) =>
    fetch(`/api/meetings/${code}/exit`, { method: 'POST', credentials: 'include' }),
  activeBots: () => req<{ active: string[] }>('/api/bots/active'),

  // Scheduled Meetings
  scheduleMeeting: (input: ScheduleInput) =>
    req<{ scheduledMeeting: ScheduledMeeting }>('/api/meetings/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  listScheduledMeetings: () =>
    req<{ scheduled: ScheduledMeeting[] }>('/api/meetings/scheduled'),
  cancelScheduledMeeting: (id: string) =>
    req<{ ok: true }>(`/api/meetings/scheduled/${id}`, { method: 'DELETE' }),
  startScheduledMeeting: (id: string) =>
    req<{ meetingId: string }>(`/api/meetings/scheduled/${id}/start`, { method: 'POST' }),

  // Calendar
  listEvents: () => req<{ events: CalendarEvent[] }>('/api/calendar/events'),
  syncCalendar: () => req<{ synced: number; events: CalendarEvent[] }>('/api/calendar/sync', { method: 'POST' }),
  setAutoJoin: (eventId: string, autoJoin: boolean) =>
    req<{ ok: true }>(`/api/calendar/events/${eventId}/auto-join`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoJoin }),
    }),

  // Support
  submitSupport: (issueType: string, message: string) =>
    req<{ ok: true; delivered: boolean }>('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueType, message }),
    }),

  // Emails
  syncEmails: (days?: number) =>
    req<{ success: boolean; syncDays: number; threadsProcessed: number; messagesProcessed: number }>(
      '/api/emails/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) },
    ),
  emailSyncStatus: () =>
    req<{ syncState: EmailSyncState | null }>('/api/emails/sync/status'),
  listEmailThreads: (opts?: { limit?: number; offset?: number; search?: string; unread?: boolean }) => {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.offset) params.set('offset', String(opts.offset))
    if (opts?.search) params.set('search', opts.search)
    if (opts?.unread) params.set('unread', 'true')
    const qs = params.toString()
    return req<{ threads: EmailThread[]; total: number }>(`/api/emails/threads${qs ? '?' + qs : ''}`)
  },
  getEmailThread: (id: string) =>
    req<{ thread: EmailThread; emails: EmailMessage[]; analysis: EmailAnalysis | null }>(`/api/emails/threads/${id}`),
  analyzeEmailThread: (id: string) =>
    req<{ analysis: EmailAnalysis }>(`/api/emails/threads/${id}/analyze`, { method: 'POST' }),
  // Defaults to the user's sync window. `allTime` re-analyzes everything ever
  // synced — only pass it when the user explicitly asks for a full re-analysis.
  batchAnalyzeEmails: (limit = 20, allTime = false) =>
    req<{ analyzed: number }>(
      `/api/emails/analyze-batch?limit=${limit}${allTime ? '&all=true' : ''}`,
      { method: 'POST' },
    ),
  getAnalysisProgress: () =>
    req<AnalysisProgress>('/api/emails/analyze-progress'),
  detectFollowUps: (days = 3) =>
    req<{ created: number }>(`/api/emails/detect-follow-ups?days=${days}`, { method: 'POST' }),
  getFollowUps: () =>
    req<{ pending: EmailFollowUp[]; overdue: EmailFollowUp[]; dueToday: EmailFollowUp[]; dueThisWeek: EmailFollowUp[] }>('/api/emails/follow-ups'),
  updateFollowUp: (id: string, status: string) =>
    req<{ ok: true }>(`/api/emails/follow-ups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  getEmailActionItems: () =>
    req<{ open: EmailActionItem[]; completedCount: number; highPriority: EmailActionItem[]; clientDependent: EmailActionItem[] }>('/api/emails/action-items'),
  updateEmailActionItem: (id: string, status: string) =>
    req<{ ok: true }>(`/api/emails/action-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  searchEmails: (q: string) =>
    req<{ results: { threadId: string; subject: string; snippet: string; matchedText: string }[] }>(`/api/emails/search?q=${encodeURIComponent(q)}`),
  emailDailyBrief: () =>
    req<EmailDailyBrief>('/api/emails/daily-brief'),
}
