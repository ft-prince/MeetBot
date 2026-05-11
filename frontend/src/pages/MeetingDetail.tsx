import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { useLiveMeetings } from '../hooks/useLiveMeetings'
import { api } from '../lib/api'
import { fmtClock, fmtDate, fmtDuration, fmtTimeOfDay, initials } from '../lib/format'
import { colorMapFor } from '../lib/colors'
import type { MeetingSummary, TranscriptSegment } from '../lib/types'

type BotStatus = 'active' | 'inactive' | 'unknown'

// ── Collapsible section ───────────────────────────────────────────────────────

function Accordion({
  title,
  icon,
  badge,
  defaultOpen = false,
  accent = false,
  children,
}: {
  title: string
  icon: string
  badge?: string | number
  defaultOpen?: boolean
  accent?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full px-5 py-3.5 flex items-center gap-2 text-left transition-colors
          ${accent ? 'bg-accent-light' : 'bg-app-bg'}
          border-b ${open ? 'border-gray-200' : 'border-transparent'}
          hover:brightness-95`}
      >
        <span className="text-base">{icon}</span>
        <span className={`text-sm font-bold flex-1 ${accent ? 'text-accent' : 'text-ink'}`}>{title}</span>
        {badge !== undefined && (
          <span className="text-[10px] font-bold bg-accent text-white px-2 py-0.5 rounded-full">{badge}</span>
        )}
        <svg
          width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"
          viewBox="0 0 24 24"
          className={`text-muted flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MeetingDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { start: startLive } = useLiveMeetings()

  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [summary, setSummary] = useState<MeetingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [botStatus, setBotStatus] = useState<BotStatus>('unknown')
  const [botAction, setBotAction] = useState<'sending' | 'stopping' | 'exiting' | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const meetingCode = summary?.meetingCode ?? null

  const loadData = useCallback(async () => {
    if (!id) return
    try {
      const [transcriptRes, summaryRes] = await Promise.allSettled([
        api.getTranscript(id),
        api.getSummary(id),
      ])
      if (transcriptRes.status === 'fulfilled') setSegments(transcriptRes.value.segments || [])
      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value)
    } finally {
      setLoading(false)
    }
  }, [id])

  const checkBotStatus = useCallback(async (code: string) => {
    try {
      const { active } = await api.activeBots()
      setBotStatus(active.includes(code) ? 'active' : 'inactive')
    } catch {
      setBotStatus('unknown')
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    loadData()
  }, [loadData])

  useEffect(() => {
    if (meetingCode) checkBotStatus(meetingCode)
  }, [meetingCode, checkBotStatus])

  useEffect(() => {
    if (botStatus !== 'active' || !meetingCode) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setInterval(async () => {
      await loadData()
      await checkBotStatus(meetingCode)
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [botStatus, meetingCode, loadData, checkBotStatus])

  const handleSendBot = async () => {
    if (!meetingCode) return
    setBotAction('sending')
    try {
      const { meetingId } = await api.joinMeeting(`https://meet.google.com/${meetingCode}`)
      startLive(meetingId)
      navigate('/live')
    } catch (err) {
      alert((err as Error).message)
      setBotAction(null)
    }
  }

  const handleStopBot = async () => {
    if (!meetingCode) return
    setBotAction('stopping')
    try {
      await api.stopMeeting(meetingCode)
      setBotStatus('inactive')
      setTimeout(() => loadData(), 2000)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBotAction(null)
    }
  }

  const handleExitBot = async () => {
    if (!meetingCode) return
    if (!confirm('Force-exit the bot? The transcript will be saved but no AI summary will be generated.')) return
    setBotAction('exiting')
    try {
      await api.exitMeeting(meetingCode)
      setBotStatus('inactive')
      setTimeout(() => loadData(), 1500)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBotAction(null)
    }
  }

  const speakerColors = useMemo(() => {
    const names = [...new Set(segments.map(s => s.speaker_name || s.speaker_label || '?'))]
    return colorMapFor(names)
  }, [segments])

  const analytics = useMemo(() => {
    const speakers = new Set(segments.map(s => s.speaker_name || s.speaker_label || '?'))
    const words = segments.reduce((sum, s) => sum + (s.text || '').split(/\s+/).filter(Boolean).length, 0)
    const dur = summary?.durationMs || 0
    const wpm = dur > 0 ? Math.round(words / (dur / 60_000)) : 0
    return { segments: segments.length, speakers: speakers.size, words, wpm }
  }, [segments, summary])

  const isLive = botStatus === 'active'
  const hasSummary = !!(summary?.summary || summary?.detailedRewrite)

  return (
    <>
      <Topbar title="Meeting Details" subtitle="" />
      <div className="p-8 flex-1">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <button onClick={() => navigate(-1)} className="btn btn-secondary btn-sm">← Back</button>
          <div className="flex-1">
            <div className="font-mono text-base font-bold text-accent">{summary?.meetingCode || id}</div>
            {summary?.startedAt && (
              <div className="text-xs text-muted mt-0.5">
                {fmtDate(summary.startedAt)} · {fmtTimeOfDay(summary.startedAt)} · {fmtDuration(summary.durationMs)}
              </div>
            )}
          </div>

          {!loading && (
            isLive
              ? <Pill variant="live">● Live</Pill>
              : hasSummary
                ? <Pill variant="done">✓ Summarized</Pill>
                : <Pill variant="pending">Processing</Pill>
          )}

          {meetingCode && (
            <div className="flex items-center gap-2">
              {isLive ? (
                <>
                  <button onClick={handleStopBot} disabled={botAction !== null} className="btn btn-secondary btn-sm">
                    {botAction === 'stopping' ? 'Stopping…' : '⏹ Stop Bot'}
                  </button>
                  <button
                    onClick={handleExitBot}
                    disabled={botAction !== null}
                    className="btn btn-sm border border-danger text-danger hover:bg-red-50 transition-colors rounded-lg px-3 py-1.5 text-xs font-semibold"
                  >
                    {botAction === 'exiting' ? 'Exiting…' : '✕ Exit Bot'}
                  </button>
                </>
              ) : (
                <button onClick={handleSendBot} disabled={botAction !== null} className="btn btn-primary btn-sm">
                  {botAction === 'sending' ? 'Launching…' : '▶ Send Bot'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Two-column layout ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* LEFT — Transcript */}
          <div className="card overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            <div className="px-5 py-3 bg-app-bg border-b border-gray-200 text-sm font-bold flex items-center gap-1.5 flex-shrink-0">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
              Full Transcript
              {isLive && <span className="ml-auto text-[10px] font-semibold text-success animate-pulse">● live</span>}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
              {loading ? (
                <p className="text-muted text-sm text-center py-8">Loading transcript…</p>
              ) : segments.length === 0 ? (
                <p className="text-muted text-sm text-center py-8">No transcript available.</p>
              ) : segments.map(seg => {
                const name = seg.speaker_name || seg.speaker_label || '?'
                const c = speakerColors[name]
                return (
                  <div key={seg.id} className="bg-app-bg rounded-r-md px-2.5 py-1.5 border-l-[3px]" style={{ borderLeftColor: c.border }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div className="w-5 h-5 rounded-full text-[8px] font-bold flex items-center justify-center" style={{ background: c.bg, color: c.text }}>
                        {initials(name)}
                      </div>
                      <span className="font-semibold text-[11px]" style={{ color: c.text }}>{name}</span>
                      <span className="text-[10px] text-muted ml-auto">{fmtClock(seg.start_ms)}</span>
                    </div>
                    <p className="text-gray-700 text-xs leading-relaxed">{seg.text}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* RIGHT — Analytics + expandable AI sections */}
          <div className="flex flex-col gap-3 overflow-y-auto pr-0.5" style={{ maxHeight: 'calc(100vh - 200px)' }}>

            {/* Analytics (always visible) */}
            <div className="card p-4">
              <div className="text-[11px] font-bold text-muted uppercase tracking-wider mb-3">📊 Analytics</div>
              <div className="grid grid-cols-4 gap-2">
                <Stat n={analytics.segments} label="Segments" />
                <Stat n={analytics.speakers} label="Speakers" />
                <Stat n={analytics.words.toLocaleString()} label="Words" />
                <Stat n={analytics.wpm || '—'} label="WPM" />
              </div>
            </div>

            {/* Detailed Rewrite */}
            <Accordion icon="📝" title="Detailed Meeting Rewrite" defaultOpen={true} accent>
              {loading ? (
                <p className="text-muted text-sm">Generating…</p>
              ) : summary?.detailedRewrite ? (
                <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line">
                  {summary.detailedRewrite}
                </p>
              ) : (
                <p className="text-muted text-sm">
                  {isLive ? 'Will be generated once the meeting ends.' : 'Not yet available.'}
                </p>
              )}
            </Accordion>

            {/* Summary */}
            <Accordion icon="🤖" title="Executive Summary" defaultOpen={true}>
              {loading ? (
                <p className="text-muted text-sm">Loading…</p>
              ) : summary?.summary ? (
                <p className="text-sm leading-relaxed text-gray-700">{summary.summary}</p>
              ) : (
                <p className="text-muted text-sm">
                  {isLive ? 'Summary will be generated after the meeting ends.' : 'Not yet available.'}
                </p>
              )}
            </Accordion>

            {/* Key Insights */}
            <Accordion
              icon="💡"
              title="Key Insights & Action Items"
              badge={summary?.keyInsights?.length || 0}
              defaultOpen={true}
            >
              {loading ? (
                <p className="text-muted text-sm">Loading…</p>
              ) : summary?.keyInsights && summary.keyInsights.length > 0 ? (
                <ul className="flex flex-col gap-0">
                  {summary.keyInsights.map((insight, i) => (
                    <li key={i} className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 last:border-b-0 last:pb-0 text-sm leading-relaxed">
                      <span className="text-accent font-bold flex-shrink-0 mt-0.5">→</span>
                      <span className="text-gray-700">{insight}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted text-sm">No insights yet.</p>
              )}
            </Accordion>

            {/* Important Points */}
            <Accordion
              icon="📌"
              title="Important Points"
              badge={summary?.importantPoints?.length || 0}
              defaultOpen={false}
            >
              {loading ? (
                <p className="text-muted text-sm">Loading…</p>
              ) : summary?.importantPoints && summary.importantPoints.length > 0 ? (
                <ul className="flex flex-col gap-0">
                  {summary.importantPoints.map((point, i) => (
                    <li key={i} className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 last:border-b-0 last:pb-0 text-sm leading-relaxed">
                      <span className="w-5 h-5 rounded-full bg-amber-100 text-warning text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-gray-700">{point}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted text-sm">No important points recorded yet.</p>
              )}
            </Accordion>

          </div>
        </div>
      </div>
    </>
  )
}

function Stat({ n, label }: { n: string | number; label: string }) {
  return (
    <div className="bg-app-bg rounded-lg p-3 text-center">
      <div className="text-xl font-extrabold leading-tight">{n}</div>
      <div className="text-[10px] text-muted mt-0.5">{label}</div>
    </div>
  )
}
