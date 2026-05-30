import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { Tabs } from '../components/Tabs'
import { api } from '../lib/api'
import { fmtClock, fmtDate, fmtDuration, fmtTimeOfDay, initials } from '../lib/format'
import { colorMapFor } from '../lib/colors'
import { computeAnalytics } from '../lib/analytics'
import type { ActionItem, Chapter, MeetingSummary, ModuleStatus, SpeakerInsight, TranscriptSegment } from '../lib/types'

type BotStatus = 'active' | 'inactive' | 'unknown'

export function MeetingDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [summary, setSummary] = useState<MeetingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [botStatus, setBotStatus] = useState<BotStatus>('unknown')
  const [botAction, setBotAction] = useState<'stopping' | 'exiting' | null>(null)
  const [botError, setBotError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const meetingCode = summary?.meetingCode ?? null

  const loadData = useCallback(async () => {
    if (!id) return
    const [tx, sm] = await Promise.allSettled([
      api.getTranscript(id),
      api.getSummary(id),
    ])
    if (tx.status === 'fulfilled') {
      setSegments(tx.value.segments || [])
      setTranscriptError(null)
    } else {
      setTranscriptError((tx.reason as Error).message)
    }
    if (sm.status === 'fulfilled') {
      setSummary(sm.value)
      setSummaryError(null)
    } else {
      setSummaryError((sm.reason as Error).message)
    }
    setLoading(false)
  }, [id])

  const checkBotStatus = useCallback(async (code: string) => {
    try {
      const { active } = await api.activeBots()
      setBotStatus(active.includes(code) ? 'active' : 'inactive')
    } catch {
      setBotStatus('unknown')
    }
  }, [])

  useEffect(() => { setLoading(true); loadData() }, [loadData])

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

  const handleStopBot = async () => {
    if (!meetingCode) return
    setBotAction('stopping'); setBotError(null)
    try {
      await api.stopMeeting(meetingCode)
      setBotStatus('inactive')
      setTimeout(() => loadData(), 2000)
    } catch (err) {
      setBotError((err as Error).message)
    } finally {
      setBotAction(null)
    }
  }

  const handleExitBot = async () => {
    if (!meetingCode) return
    if (!confirm('Force-exit the bot? The transcript will be saved but no AI summary will be generated.')) return
    setBotAction('exiting'); setBotError(null)
    try {
      await api.exitMeeting(meetingCode)
      setBotStatus('inactive')
      setTimeout(() => loadData(), 1500)
    } catch (err) {
      setBotError((err as Error).message)
    } finally {
      setBotAction(null)
    }
  }

  const speakerColors = useMemo(() => {
    const names = [...new Set(segments.map(s => s.speaker_name || s.speaker_label || '?'))]
    return colorMapFor(names)
  }, [segments])

  const analytics = useMemo(
    () => computeAnalytics(segments, summary?.durationMs ?? null),
    [segments, summary],
  )

  const isLive = botStatus === 'active'
  const hasSummary = !!(summary?.summary || summary?.detailedRewrite)
  const isProcessing = !isLive && !hasSummary && !loading

  // Auto-poll every 6 s while the AI pipeline is running (no summary yet, bot gone).
  // Stops automatically the moment hasSummary flips to true.
  useEffect(() => {
    if (!isProcessing) {
      if (processPollRef.current) { clearInterval(processPollRef.current); processPollRef.current = null }
      return
    }
    processPollRef.current = setInterval(() => { loadData() }, 6000)
    return () => { if (processPollRef.current) { clearInterval(processPollRef.current); processPollRef.current = null } }
  }, [isProcessing, loadData])

  const tabs = [
    { id: 'transcript', label: 'Transcript', badge: segments.length || null },
    { id: 'summary', label: 'Summary' },
    { id: 'actions', label: 'Actions', badge: summary?.actionItems?.length || null },
    { id: 'insights', label: 'Insights', badge: (summary?.keyInsights?.length || 0) + (summary?.keyQuestions?.length || 0) || null },
    { id: 'speakers', label: 'Speakers', badge: (summary?.speakerInsights?.length || analytics.participantCount) || null },
    { id: 'chapters', label: 'Chapters', badge: summary?.chapters?.length || null },
    { id: 'analytics', label: 'Analytics' },
  ]

  return (
    <>
      <Topbar title="Meeting Details" subtitle="" />
      <div className="p-4 sm:p-8 flex-1">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <button onClick={() => navigate(-1)} className="btn btn-secondary btn-sm">Back</button>
          <div className="flex-1">
            <div className="font-mono text-base font-bold text-accent">{summary?.meetingCode || id}</div>
            {summary?.startedAt && (
              <div className="text-xs text-muted mt-0.5">
                {fmtDate(summary.startedAt)} · {fmtTimeOfDay(summary.startedAt)} · {fmtDuration(summary.durationMs)}
              </div>
            )}
          </div>
          {!loading && summary?.language && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {summary.language}
            </span>
          )}
          {!loading && (
            isLive
              ? <Pill variant="live">Live</Pill>
              : hasSummary
                ? <Pill variant="done">Summarized</Pill>
                : <Pill variant="pending">Processing</Pill>
          )}
          {meetingCode && isLive && (
            <div className="flex items-center gap-2">
              <button onClick={handleStopBot} disabled={botAction !== null} className="btn btn-secondary btn-sm">
                {botAction === 'stopping' ? 'Stopping…' : 'Stop Bot'}
              </button>
              <button onClick={handleExitBot} disabled={botAction !== null} className="btn btn-sm border border-danger text-danger hover:bg-red-50 transition-colors rounded-lg px-3 py-1.5 text-xs font-semibold">
                {botAction === 'exiting' ? 'Exiting…' : 'Exit Bot'}
              </button>
            </div>
          )}
        </div>

        {botError && (
          <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-danger">{botError}</div>
        )}

        <Tabs
          tabs={tabs}
          renderContent={(id) => {
            switch (id) {
              case 'transcript':
                return (
                  <TranscriptTab
                    loading={loading}
                    error={transcriptError}
                    segments={segments}
                    speakerColors={speakerColors}
                    isLive={isLive}
                  />
                )
              case 'summary':
                return (
                  <SummaryTab
                    loading={loading}
                    error={summaryError}
                    summary={summary}
                    isLive={isLive}
                    isProcessing={isProcessing}
                  />
                )
              case 'actions':
                return (
                  <ActionItemsTab
                    loading={loading}
                    error={summaryError}
                    items={summary?.actionItems ?? []}
                    moduleStatus={summary?.processingStatus?.actionItems}
                    isLive={isLive}
                    isProcessing={isProcessing}
                  />
                )
              case 'insights':
                return (
                  <InsightsTab
                    loading={loading}
                    error={summaryError}
                    summary={summary}
                    isLive={isLive}
                    isProcessing={isProcessing}
                  />
                )
              case 'speakers':
                return (
                  <SpeakersTab
                    loading={loading}
                    analytics={analytics}
                    insights={summary?.speakerInsights ?? []}
                    moduleStatus={summary?.processingStatus?.speakers}
                    speakerColors={speakerColors}
                    isLive={isLive}
                  />
                )
              case 'chapters':
                return (
                  <ChaptersTab
                    loading={loading}
                    chapters={summary?.chapters ?? []}
                    moduleStatus={summary?.processingStatus?.chapters}
                    isLive={isLive}
                    isProcessing={isProcessing}
                  />
                )
              case 'analytics':
                return (
                  <AnalyticsTab
                    loading={loading}
                    analytics={analytics}
                    durationMs={summary?.durationMs ?? null}
                  />
                )
              default:
                return null
            }
          }}
        />
      </div>
    </>
  )
}

// ─── Tab content components ──────────────────────────────────────────────────

function TabPad({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={'px-5 py-5 ' + className}>{children}</div>
}

function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <TabPad className="text-center py-12">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </TabPad>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <TabPad className="text-center py-12">
      <div className="text-3xl mb-2">⚠️</div>
      <div className="text-sm font-semibold text-danger">Failed to load</div>
      <div className="text-xs text-muted mt-1">{message}</div>
    </TabPad>
  )
}

function LoadingState() {
  return (
    <TabPad className="flex items-center justify-center py-12">
      <svg className="animate-spin text-accent" width="22" height="22" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </TabPad>
  )
}

function ProcessingState({ label = 'Generating AI summary' }: { label?: string }) {
  return (
    <TabPad className="flex flex-col items-center justify-center py-14 gap-3">
      <div className="relative w-12 h-12">
        <svg className="animate-spin text-accent" width="48" height="48" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
      <div className="text-sm font-semibold text-gray-700">{label}…</div>
      <div className="text-xs text-muted">This usually takes 30–60 seconds. Hang tight!</div>
    </TabPad>
  )
}

function TranscriptTab({
  loading, error, segments, speakerColors, isLive,
}: {
  loading: boolean
  error: string | null
  segments: TranscriptSegment[]
  speakerColors: Record<string, { bg: string; text: string; border: string }>
  isLive: boolean
}) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (segments.length === 0) {
    return <EmptyState icon="📝" title="No transcript yet" hint={isLive ? 'Transcription is in progress…' : 'No audio was captured.'} />
  }
  return (
    <div className="max-h-[70vh] overflow-y-auto px-4 py-4 flex flex-col gap-2">
      {isLive && (
        <div className="text-[10px] font-bold uppercase tracking-wider text-success self-end animate-pulse mb-1">
          ● live
        </div>
      )}
      {segments.map(seg => {
        const name = seg.speaker_name || seg.speaker_label || '?'
        const c = speakerColors[name]
        return (
          <div key={seg.id} className="bg-app-bg rounded-r-md px-3 py-2 border-l-[3px]" style={{ borderLeftColor: c.border }}>
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
  )
}

function SummaryTab({
  loading, error, summary, isLive, isProcessing,
}: {
  loading: boolean
  error: string | null
  summary: MeetingSummary | null
  isLive: boolean
  isProcessing: boolean
}) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  const hasShort = !!summary?.summary
  const hasLong = !!summary?.detailedRewrite
  if (!hasShort && !hasLong) {
    if (isProcessing) return <ProcessingState label="Generating AI summary" />
    return <EmptyState icon="🤖" title={isLive ? 'Summary not ready yet' : 'No summary available'} hint={isLive ? 'Will be generated when the meeting ends.' : ''} />
  }
  return (
    <TabPad className="flex flex-col gap-5">
      {hasShort && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Executive Summary</h3>
          <p className="text-sm leading-relaxed text-gray-800">{summary!.summary}</p>
        </section>
      )}
      {hasLong && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Detailed Rewrite</h3>
          <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-line">{summary!.detailedRewrite}</p>
        </section>
      )}
    </TabPad>
  )
}

function StatusBadge({ status }: { status: ModuleStatus | undefined }) {
  if (!status || status === 'ok') return null
  const variants: Record<string, string> = {
    partial: 'bg-amber-50 text-warning border-amber-200',
    failed: 'bg-red-50 text-danger border-red-200',
    skipped: 'bg-gray-50 text-muted border-gray-200',
  }
  const labels: Record<string, string> = {
    partial: 'Partial — some content may be missing',
    failed: 'AI module failed — try again later',
    skipped: 'AI module skipped (no API key or insufficient content)',
  }
  return (
    <div className={'text-[11px] font-semibold px-3 py-1.5 rounded-md border mb-3 ' + variants[status]}>
      {labels[status]}
    </div>
  )
}

function ActionItemsTab({
  loading, error, items, moduleStatus, isLive, isProcessing,
}: {
  loading: boolean
  error: string | null
  items: ActionItem[]
  moduleStatus: ModuleStatus | undefined
  isLive: boolean
  isProcessing: boolean
}) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (items.length === 0) {
    if (isProcessing) return <ProcessingState label="Extracting action items" />
    return <EmptyState icon="✅" title={isLive ? 'Action items appear after the meeting' : 'No action items extracted'} hint={moduleStatus === 'failed' ? 'AI module failed — retry by re-summarizing.' : ''} />
  }
  return (
    <TabPad>
      <StatusBadge status={moduleStatus} />
      <ul className="flex flex-col gap-2">
        {items.map((a, i) => (
          <li key={i} className="border border-gray-200 rounded-lg p-3 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-accent-light text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 leading-relaxed">{a.task}</p>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {a.owner && (
                  <span className="text-[11px] font-semibold text-accent">
                    👤 {a.owner}
                  </span>
                )}
                {a.dueHint && (
                  <span className="text-[11px] font-semibold text-warning">
                    📅 {a.dueHint}
                  </span>
                )}
                {!a.owner && !a.dueHint && (
                  <span className="text-[11px] text-muted">No owner or due date specified</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </TabPad>
  )
}

function InsightsTab({
  loading, error, summary, isLive, isProcessing,
}: {
  loading: boolean
  error: string | null
  summary: MeetingSummary | null
  isLive: boolean
  isProcessing: boolean
}) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  const insights = summary?.keyInsights ?? []
  const important = summary?.importantPoints ?? []
  const questions = summary?.keyQuestions ?? []
  if (insights.length === 0 && important.length === 0 && questions.length === 0) {
    if (isProcessing) return <ProcessingState label="Extracting key insights" />
    return <EmptyState icon="💡" title="No insights yet" hint={isLive ? 'Generated after the meeting ends.' : ''} />
  }
  return (
    <TabPad className="flex flex-col gap-5">
      <StatusBadge status={summary?.processingStatus?.insights} />
      {insights.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Key Insights</h3>
          <ul className="flex flex-col gap-0">
            {insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 last:border-b-0 last:pb-0 text-sm leading-relaxed">
                <span className="text-accent font-bold flex-shrink-0 mt-0.5">→</span>
                <span className="text-gray-700">{insight}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {important.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Important Points</h3>
          <ul className="flex flex-col gap-0">
            {important.map((point, i) => (
              <li key={i} className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 last:border-b-0 last:pb-0 text-sm leading-relaxed">
                <span className="w-5 h-5 rounded-full bg-amber-100 text-warning text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <span className="text-gray-700">{point}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {questions.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Open Questions</h3>
          <ul className="flex flex-col gap-0">
            {questions.map((q, i) => (
              <li key={i} className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 last:border-b-0 last:pb-0 text-sm leading-relaxed">
                <span className="text-blue-600 font-bold flex-shrink-0 mt-0.5">?</span>
                <span className="text-gray-700">{q}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </TabPad>
  )
}

function SpeakersTab({
  loading, analytics, insights, moduleStatus, speakerColors, isLive,
}: {
  loading: boolean
  analytics: ReturnType<typeof computeAnalytics>
  insights: SpeakerInsight[]
  moduleStatus: ModuleStatus | undefined
  speakerColors: Record<string, { bg: string; text: string; border: string }>
  isLive: boolean
}) {
  if (loading) return <LoadingState />
  if (analytics.speakers.length === 0) {
    return <EmptyState icon="🎙️" title="No speakers identified yet" hint={isLive ? 'Speakers appear as they talk.' : ''} />
  }
  return (
    <TabPad className="flex flex-col gap-4">
      {analytics.mostActive && (
        <div className="bg-accent-light border border-orange-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <div className="text-xl">🏆</div>
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-accent">Most Active</div>
            <div className="text-sm font-bold text-ink">{analytics.mostActive.name}</div>
            <div className="text-xs text-muted">
              {Math.round(analytics.mostActive.pctTime)}% of speaking time · {analytics.mostActive.words.toLocaleString()} words
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {analytics.speakers.map(s => {
          const c = speakerColors[s.name] ?? { bg: '#eee', text: '#333', border: '#999' }
          return (
            <div key={s.name} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: c.bg, color: c.text }}>
                  {initials(s.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{s.name}</div>
                  <div className="text-[11px] text-muted">
                    {s.segments} segment{s.segments === 1 ? '' : 's'} · {s.words.toLocaleString()} words · {fmtDuration(s.speakingMs)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-accent">{Math.round(s.pctTime)}%</div>
                  <div className="text-[10px] text-muted">speaking time</div>
                </div>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${s.pctTime}%`, background: c.border }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <StatusBadge status={moduleStatus} />

      {insights.length > 0 && (
        <section className="mt-2 flex flex-col gap-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">Speaker Insights</h3>
          {insights.map(si => {
            const c = speakerColors[si.name] ?? { bg: '#eee', text: '#333', border: '#999' }
            return (
              <div key={'si-' + si.name} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: c.bg, color: c.text }}>
                    {initials(si.name)}
                  </div>
                  <div className="text-sm font-bold">{si.name}</div>
                </div>
                {si.contributions.length > 0 && (
                  <InsightList label="Contributions" icon="💡" items={si.contributions} />
                )}
                {si.ownership.length > 0 && (
                  <InsightList label="Ownership" icon="🎯" items={si.ownership} />
                )}
                {si.collaboration.length > 0 && (
                  <InsightList label="Collaboration" icon="🤝" items={si.collaboration} />
                )}
              </div>
            )
          })}
        </section>
      )}
      {insights.length === 0 && moduleStatus !== 'ok' && (
        <p className="text-[11px] text-muted">
          Per-speaker contributions, ownership, and collaboration {moduleStatus === 'failed' ? 'failed to generate this time.' : 'will appear once the AI pipeline runs.'}
        </p>
      )}
    </TabPad>
  )
}

function InsightList({ label, icon, items }: { label: string; icon: string; items: string[] }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1 flex items-center gap-1">
        <span>{icon}</span>{label}
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((x, i) => (
          <li key={i} className="text-xs text-gray-700 leading-snug pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-accent">
            {x}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChaptersTab({
  loading, chapters, moduleStatus, isLive, isProcessing,
}: {
  loading: boolean
  chapters: Chapter[]
  moduleStatus: ModuleStatus | undefined
  isLive: boolean
  isProcessing: boolean
}) {
  if (loading) return <LoadingState />
  if (chapters.length === 0) {
    if (isProcessing) return <ProcessingState label="Generating chapters" />
    return <EmptyState icon="📑" title={isLive ? 'Chapters appear after the meeting' : 'No chapters generated'} hint={moduleStatus === 'failed' ? 'AI module failed to chapter the transcript.' : ''} />
  }
  return (
    <TabPad>
      <StatusBadge status={moduleStatus} />
      <ol className="flex flex-col gap-2">
        {chapters.map((c, i) => {
          const fmt = (ms: number) => {
            const s = Math.floor(ms / 1000)
            return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
          }
          return (
            <li key={i} className="border border-gray-200 rounded-lg p-3 flex items-start gap-3">
              <div className="w-9 text-[10px] font-mono font-bold text-accent flex-shrink-0 pt-0.5">
                {fmt(c.startMs)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-ink">{c.title}</div>
                {c.summary && <div className="text-xs text-gray-600 mt-0.5">{c.summary}</div>}
                <div className="text-[10px] text-muted mt-1">
                  {fmt(c.startMs)} → {fmt(c.endMs)}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </TabPad>
  )
}

function AnalyticsTab({
  loading, analytics, durationMs,
}: {
  loading: boolean
  analytics: ReturnType<typeof computeAnalytics>
  durationMs: number | null
}) {
  if (loading) return <LoadingState />
  return (
    <TabPad className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat n={analytics.participantCount} label="Participants" />
        <Stat n={analytics.totalSegments} label="Segments" />
        <Stat n={analytics.totalWords.toLocaleString()} label="Total Words" />
        <Stat n={analytics.wpm || '—'} label="Words / min" />
        <Stat n={fmtDuration(durationMs)} label="Duration" />
        <Stat n={fmtDuration(analytics.totalSpeakingMs)} label="Speaking Time" />
        <Stat n={analytics.avgWordsPerSegment} label="Avg Words / Segment" />
        <Stat
          n={analytics.mostActive ? analytics.mostActive.name.split(' ')[0] : '—'}
          label="Most Active"
        />
      </div>

      {analytics.speakers.length > 1 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-3">Speaking Distribution</h3>
          <div className="flex h-3 rounded-full overflow-hidden border border-gray-200">
            {analytics.speakers.map((s, i) => (
              <div
                key={s.name}
                className="h-full"
                style={{
                  width: `${s.pctTime}%`,
                  background: `hsl(${(i * 47) % 360}, 65%, 55%)`,
                }}
                title={`${s.name} — ${Math.round(s.pctTime)}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {analytics.speakers.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: `hsl(${(i * 47) % 360}, 65%, 55%)` }}
                />
                <span className="font-semibold text-gray-700">{s.name}</span>
                <span className="text-muted">{Math.round(s.pctTime)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </TabPad>
  )
}

function Stat({ n, label }: { n: string | number; label: string }) {
  return (
    <div className="bg-app-bg rounded-lg p-3 text-center">
      <div className="text-xl font-extrabold leading-tight truncate">{n}</div>
      <div className="text-[10px] text-muted mt-0.5">{label}</div>
    </div>
  )
}