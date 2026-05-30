import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { api } from '../lib/api'
import type { EmailThread, EmailMessage, EmailAnalysis } from '../lib/types'

type Tab = 'conversation' | 'analysis' | 'actions'

export function EmailThreadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [thread, setThread] = useState<EmailThread | null>(null)
  const [emails, setEmails] = useState<EmailMessage[]>([])
  const [analysis, setAnalysis] = useState<EmailAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [tab, setTab] = useState<Tab>('conversation')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api.getEmailThread(id)
      .then(({ thread: t, emails: e, analysis: a }) => {
        setThread(t)
        setEmails(e)
        setAnalysis(a)
        if (e.length > 0) setExpandedIds(new Set([e[e.length - 1].id]))
      })
      .catch(() => navigate('/emails'))
      .finally(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = async () => {
    if (!id) return
    setAnalyzing(true)
    try {
      const { analysis: a } = await api.analyzeEmailThread(id)
      setAnalysis(a)
      setTab('analysis')
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const toggleExpand = (emailId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(emailId)) next.delete(emailId)
      else next.add(emailId)
      return next
    })
  }

  if (loading) {
    return (
      <>
        <Topbar title="Email Thread" subtitle="Loading…" />
        <div className="p-8 flex justify-center">
          <svg className="animate-spin text-accent" width="24" height="24" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </>
    )
  }

  if (!thread) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'conversation', label: 'Conversation' },
    { key: 'analysis', label: 'AI Analysis' },
    { key: 'actions', label: 'Actions' },
  ]

  return (
    <>
      <Topbar
        title={thread.subject || '(no subject)'}
        subtitle={`${thread.messageCount} message${thread.messageCount !== 1 ? 's' : ''} · ${thread.participants.length} participant${thread.participants.length !== 1 ? 's' : ''}`}
      />
      <div className="p-3 sm:p-6 lg:p-8 flex-1 overflow-y-auto">
        {/* Header bar */}
        <div className="card p-3 sm:p-4 mb-4 sm:mb-5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <button onClick={() => navigate('/emails')} className="btn btn-secondary btn-sm self-start">
            <span className="flex items-center gap-1">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </span>
          </button>
          <div className="flex-1" />
          <button onClick={handleAnalyze} disabled={analyzing} className="btn btn-primary btn-sm w-full sm:w-auto">
            {analyzing ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Analyze with AI'}
          </button>
        </div>

        {/* Quick brief */}
        {analysis && (
          <div className="card p-3 sm:p-4 mb-4 sm:mb-5 bg-amber-50 border-amber-200">
            <div className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1.5">Quick Brief</div>
            <p className="text-sm text-amber-900 break-words">{analysis.summary}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Pill variant={analysis.status === 'Resolved' ? 'done' : 'pending'}>{analysis.status}</Pill>
              {analysis.followUpNeeded && <Pill variant="pending">Follow-up needed</Pill>}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 sm:gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap '
                + (tab === t.key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'conversation' && (
          <div className="space-y-2">
            {emails.map(e => (
              <EmailCard
                key={e.id}
                email={e}
                isExpanded={expandedIds.has(e.id)}
                onToggle={() => toggleExpand(e.id)}
              />
            ))}
          </div>
        )}

        {tab === 'analysis' && (
          <AnalysisTab analysis={analysis} onAnalyze={handleAnalyze} analyzing={analyzing} />
        )}

        {tab === 'actions' && (
          <ActionsTab analysis={analysis} />
        )}
      </div>
    </>
  )
}

function EmailCard({ email, isExpanded, onToggle }: { email: EmailMessage; isExpanded: boolean; onToggle: () => void }) {
  const date = new Date(email.sentAt)
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={'card overflow-hidden ' + (email.isSentByUser ? 'border-l-4 border-l-accent' : '')}>
      <div
        onClick={onToggle}
        className="px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <div className={'w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold text-white flex-shrink-0 ' + (email.isSentByUser ? 'bg-accent' : 'bg-gray-400')}>
          {(email.fromName || email.fromAddress)[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
            {email.fromName || email.fromAddress}
            {email.isSentByUser && <span className="text-xs text-muted ml-1">(you)</span>}
          </div>
          <div className="text-xs text-muted">
            <span className="hidden sm:inline">{dateStr} at </span>{timeStr}
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {email.hasAttachments && (
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="hidden sm:block">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          )}
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            className={'transform transition-transform ' + (isExpanded ? 'rotate-180' : '')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      {isExpanded && (
        <div className="px-3 sm:px-5 pb-3 sm:pb-4 border-t border-gray-100">
          <div className="text-xs text-muted py-2 break-all">
            To: {email.toAddresses.join(', ')}
            {email.ccAddresses.length > 0 && <span className="hidden sm:inline"> · CC: {email.ccAddresses.join(', ')}</span>}
          </div>
          <div className="text-sm whitespace-pre-wrap leading-relaxed break-words">{email.bodyText || '(no text content)'}</div>
        </div>
      )}
    </div>
  )
}

function AnalysisTab({ analysis, onAnalyze, analyzing }: { analysis: EmailAnalysis | null; onAnalyze: () => void; analyzing: boolean }) {
  if (!analysis) {
    return (
      <div className="text-center py-12 sm:py-16 text-muted">
        <p className="text-sm mb-3">No analysis yet. Run AI analysis to get insights.</p>
        <button onClick={onAnalyze} disabled={analyzing} className="btn btn-primary">
          {analyzing ? 'Analyzing…' : 'Analyze Now'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <Section title="Summary">
        <p className="text-sm break-words">{analysis.summary}</p>
      </Section>

      {analysis.keyPoints.length > 0 && (
        <Section title="Key Points">
          <ul className="list-disc list-inside space-y-1">
            {analysis.keyPoints.map((p, i) => <li key={i} className="text-sm break-words">{p}</li>)}
          </ul>
        </Section>
      )}

      {analysis.decisions.length > 0 && (
        <Section title="Decisions Made">
          <ul className="list-disc list-inside space-y-1">
            {analysis.decisions.map((d, i) => <li key={i} className="text-sm break-words">{d}</li>)}
          </ul>
        </Section>
      )}

      {analysis.risks.length > 0 && (
        <Section title="Risks & Concerns">
          <ul className="list-disc list-inside space-y-1">
            {analysis.risks.map((r, i) => <li key={i} className="text-sm text-danger break-words">{r}</li>)}
          </ul>
        </Section>
      )}

      {analysis.nextAction && (
        <Section title="Next Action">
          <p className="text-sm font-medium break-words">{analysis.nextAction}</p>
        </Section>
      )}
    </div>
  )
}

function ActionsTab({ analysis }: { analysis: EmailAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="text-center py-12 sm:py-16 text-muted text-sm">
        Run AI analysis first to see action items and follow-up recommendations.
      </div>
    )
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {analysis.followUpNeeded && (
        <div className="card p-3 sm:p-4 bg-amber-50 border-amber-200">
          <div className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">Follow-up Needed</div>
          <p className="text-sm text-amber-900 break-words">{analysis.followUpReason}</p>
        </div>
      )}

      {analysis.suggestedReply && (
        <Section title="Suggested Reply">
          <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap break-words">{analysis.suggestedReply}</div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-xs font-bold text-muted uppercase tracking-wider mb-2">{title}</div>
      {children}
    </div>
  )
}
