import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LiveSegment, SpeakerColor, WSMessage } from '../lib/types'
import { SPEAKER_COLORS } from '../lib/colors'

export type LiveStatus = 'connecting' | 'joining' | 'live' | 'ended' | 'error'

export interface LiveMeeting {
  id: string
  /** DB UUID — populated from the meeting.ended WS event */
  dbId?: string
  status: LiveStatus
  statusText: string
  segments: LiveSegment[]
  interim: { speaker: string; text: string } | null
  speakerColors: Record<string, SpeakerColor>
  summary: { text: string; insights: string[] } | null
}

interface Store {
  meetings: Map<string, LiveMeeting>
  start: (id: string) => void
  stop: (id: string) => Promise<string | null>
}

const Ctx = createContext<Store | null>(null)

export function LiveMeetingsProvider({ children }: { children: ReactNode }) {
  const [meetings, setMeetings] = useState<Map<string, LiveMeeting>>(new Map())
  const wsRef = useRef<Map<string, WebSocket>>(new Map())
  const colorIdxRef = useRef<Map<string, number>>(new Map())
  // Mirror of meetings state for use inside callbacks without stale closure issues
  const meetingsRef = useRef<Map<string, LiveMeeting>>(new Map())

  useEffect(() => {
    meetingsRef.current = meetings
  }, [meetings])

  const update = useCallback((id: string, patch: Partial<LiveMeeting> | ((prev: LiveMeeting) => LiveMeeting)) => {
    setMeetings(prev => {
      const m = prev.get(id)
      if (!m) return prev
      const next = new Map(prev)
      next.set(id, typeof patch === 'function' ? patch(m) : { ...m, ...patch })
      return next
    })
  }, [])

  const assignColor = useCallback((id: string, name: string) => {
    let color: SpeakerColor | undefined
    setMeetings(prev => {
      const m = prev.get(id)
      if (!m) return prev
      if (m.speakerColors[name]) { color = m.speakerColors[name]; return prev }
      const idx = colorIdxRef.current.get(id) || 0
      color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]
      colorIdxRef.current.set(id, idx + 1)
      const next = new Map(prev)
      next.set(id, { ...m, speakerColors: { ...m.speakerColors, [name]: color } })
      return next
    })
    return color || SPEAKER_COLORS[0]
  }, [])

  // meetingCode = the state-map key (e.g. "abc-defg-hij")
  // dbId        = the DB UUID received from the meeting.ended WS event
  const pollSummary = useCallback(async (meetingCode: string, dbId: string, attempts = 0) => {
    if (attempts > 20) return
    try {
      const res = await fetch(`/api/meetings/${dbId}/summary`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json() as { summary?: string | null; keyInsights?: string[] }
        if (data.summary) {
          update(meetingCode, {
            summary: { text: data.summary, insights: data.keyInsights || [] },
            status: 'ended',
            statusText: 'Meeting ended',
          })
          return
        }
      }
    } catch {
      // network error — retry below
    }
    setTimeout(() => pollSummary(meetingCode, dbId, attempts + 1), 6000)
  }, [update])

  const start = useCallback((id: string) => {
    setMeetings(prev => {
      if (prev.has(id)) return prev
      const next = new Map(prev)
      next.set(id, {
        id,
        status: 'connecting',
        statusText: 'Bot joining…',
        segments: [],
        interim: null,
        speakerColors: {},
        summary: null,
      })
      return next
    })

    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/panel?meetingId=${id}`)
    wsRef.current.set(id, ws)

    ws.onopen = () => update(id, { status: 'joining', statusText: 'Bot joining meeting…' })
    ws.onclose = () => update(id, prev => prev.status === 'ended' ? prev : { ...prev, statusText: 'Disconnected' })
    ws.onerror = () => update(id, { status: 'error', statusText: 'Connection error' })

    ws.onmessage = (e) => {
      const msg: WSMessage = JSON.parse(e.data as string)
      switch (msg.type) {
        case 'bot.joined':
          update(id, { status: 'live', statusText: 'Live — transcribing' })
          break
        case 'bot.error':
          update(id, { status: 'error', statusText: msg.error || 'Bot error' })
          break
        case 'meeting.ended': {
          const dbId = msg.meetingId
          update(id, {
            status: 'ended',
            statusText: 'Meeting ended — generating summary…',
            ...(dbId ? { dbId } : {}),
          })
          ws.close()
          if (dbId) pollSummary(id, dbId)
          break
        }
        case 'transcript.interim': {
          const name = msg.speakerName || msg.speakerLabel || '?'
          assignColor(id, name)
          update(id, { interim: { speaker: name, text: msg.text || '' } })
          break
        }
        case 'transcript.final': {
          const name = msg.speakerName || msg.speakerLabel || '?'
          assignColor(id, name)
          const sid = msg.segmentId || `${Date.now()}`
          const seg = {
            id: sid,
            speakerLabel: msg.speakerLabel || null,
            speakerName: msg.speakerName || null,
            text: msg.text || '',
            startMs: msg.startMs || 0,
          }
          update(id, prev => {
            // Upsert by id: engines like Vexa send the same segment id repeatedly as
            // the text refines, so replace in place instead of appending duplicates.
            // In-house finals carry unique ids, so this still behaves as an append.
            const idx = prev.segments.findIndex(s => s.id === sid)
            const segments = idx >= 0
              ? prev.segments.map((s, i) => (i === idx ? seg : s))
              : [...prev.segments, seg]
            return { ...prev, interim: null, segments }
          })
          break
        }
        case 'speaker.identified': {
          if (!msg.name || !msg.label) break
          const label = msg.label
          const name = msg.name
          assignColor(id, name)
          update(id, prev => ({
            ...prev,
            segments: prev.segments.map(s => s.speakerLabel === label ? { ...s, speakerName: name } : s),
          }))
          break
        }
      }
    }
  }, [assignColor, pollSummary, update])

  const stop = useCallback(async (id: string): Promise<string | null> => {
    let dbId = meetingsRef.current.get(id)?.dbId ?? null

    await fetch(`/api/meetings/${id}/stop`, { method: 'POST', credentials: 'include' }).catch(() => {})
    wsRef.current.get(id)?.close()
    wsRef.current.delete(id)

    if (!dbId) {
      try {
        const res = await fetch('/api/meetings', { credentials: 'include' })
        if (res.ok) {
          const body = await res.json() as { meetings: { id: string; meeting_code: string }[] }
          dbId = body.meetings.find(m => m.meeting_code === id)?.id ?? null
        }
      } catch {
        // best-effort — caller handles null
      }
    }

    setMeetings(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    colorIdxRef.current.delete(id)
    return dbId
  }, [])

  // Reconnect any bots that are still running after a page refresh
  useEffect(() => {
    fetch('/api/bots/active', { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ active: string[] }> : null)
      .then(data => {
        if (!data?.active?.length) return
        for (const code of data.active) start(code)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — only runs on mount; start is stable

  // Cleanup on unmount
  useEffect(() => () => { wsRef.current.forEach(ws => ws.close()) }, [])

  return <Ctx.Provider value={{ meetings, start, stop }}>{children}</Ctx.Provider>
}

export function useLiveMeetings(): Store {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLiveMeetings must be used inside <LiveMeetingsProvider>')
  return ctx
}
