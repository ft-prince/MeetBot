import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { AnalysisProgressPanel } from '../components/AnalysisProgress'
import { api } from '../lib/api'
import type { EmailThread, EmailSyncState } from '../lib/types'

export function EmailInbox() {
  const navigate = useNavigate()
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [total, setTotal] = useState(0)
  const [syncState, setSyncState] = useState<EmailSyncState | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(true)

  const LIMIT = 30

  const loadThreads = async () => {
    setLoading(true)
    try {
      const { threads: t, total: n } = await api.listEmailThreads({
        limit: LIMIT,
        offset: page * LIMIT,
        search: query || undefined,
        unread: unreadOnly || undefined,
      })
      setThreads(t)
      setTotal(n)
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }

  const loadSyncState = async () => {
    try {
      const { syncState: s } = await api.emailSyncStatus()
      setSyncState(s)
    } catch {}
  }

  useEffect(() => { loadThreads(); loadSyncState() }, [page, unreadOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => { setPage(0); loadThreads() }, 400)
    return () => clearTimeout(timer)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.syncEmails()
      await loadThreads()
      await loadSyncState()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  const handleBatchAnalyze = async () => {
    setAnalyzing(true)
    try {
      await api.batchAnalyzeEmails()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)
  const lastSyncLabel = syncState?.lastSyncAt
    ? new Date(syncState.lastSyncAt).toLocaleString()
    : 'Never'

  return (
    <>
      <Topbar title="Email Intelligence" subtitle="AI-powered email analysis and follow-up tracking" />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Fixed header: sync bar + progress + filters */}
        <div className="flex-shrink-0 px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 lg:pt-8">
          {/* Sync bar */}
          <div className="card p-3 sm:p-4 mb-3 sm:mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  <MailIcon />
                  Email Sync
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Last synced: {lastSyncLabel}
                  {syncState?.totalSynced ? ` · ${syncState.totalSynced} threads` : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleSync} disabled={syncing} className="btn btn-primary btn-sm flex-1 sm:flex-none">
                  {syncing ? 'Syncing…' : 'Sync Emails'}
                </button>
                <button onClick={handleBatchAnalyze} disabled={analyzing} className="btn btn-secondary btn-sm flex-1 sm:flex-none">
                  {analyzing ? 'Analyzing…' : 'Analyze All'}
                </button>
                <button onClick={() => navigate('/emails/dashboard')} className="btn btn-secondary btn-sm flex-1 sm:flex-none">
                  Dashboard
                </button>
              </div>
            </div>
          </div>

          {/* Analysis progress */}
          <AnalysisProgressPanel />

          {/* Filters */}
          <div className="card p-3 sm:p-3.5 mb-3 sm:mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search email threads…"
                className="input w-full sm:flex-1 sm:max-w-md"
              />
              <div className="flex items-center justify-between gap-3 sm:gap-4">
                <label className="flex items-center gap-1.5 text-sm text-muted cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={unreadOnly} onChange={e => { setUnreadOnly(e.target.checked); setPage(0) }} className="rounded" />
                  Unread only
                </label>
                <span className="text-xs text-muted whitespace-nowrap">{total} thread{total !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable thread list */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 lg:px-8 pb-3 sm:pb-6 lg:pb-8">
          {loading ? (
            <LoadingSpinner />
          ) : threads.length === 0 ? (
            <EmptyState onSync={handleSync} hasSynced={!!syncState?.lastSyncAt} />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block card overflow-hidden">
                {threads.map(t => (
                  <ThreadRow key={t.id} thread={t} onClick={() => navigate(`/emails/${t.id}`)} />
                ))}
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden flex flex-col gap-2">
                {threads.map(t => (
                  <MobileThreadCard key={t.id} thread={t} onClick={() => navigate(`/emails/${t.id}`)} />
                ))}
              </div>
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-secondary btn-sm">
                Prev
              </button>
              <span className="text-sm text-muted">
                {page + 1} / {totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn btn-secondary btn-sm">
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function ThreadRow({ thread, onClick }: { thread: EmailThread; onClick: () => void }) {
  const date = new Date(thread.lastMessageAt)
  const isToday = new Date().toDateString() === date.toDateString()
  const dateStr = isToday
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const senderNames = thread.participants
    .slice(0, 3)
    .map(p => p.name || p.email.split('@')[0])
    .join(', ')

  return (
    <div
      onClick={onClick}
      className={
        'px-4 sm:px-5 py-3 sm:py-3.5 border-b border-gray-200 last:border-b-0 flex items-center gap-3 sm:gap-3.5 cursor-pointer hover:bg-app-bg transition-colors'
        + (thread.isUnread ? ' bg-blue-50/50' : '')
      }
    >
      <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center bg-accent-light flex-shrink-0">
        <MailIcon />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={'text-sm overflow-hidden text-ellipsis whitespace-nowrap ' + (thread.isUnread ? 'font-bold' : 'font-semibold')}>
            {thread.subject || '(no subject)'}
          </span>
          {thread.isUnread && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />}
        </div>
        <div className="text-xs text-muted mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
          {senderNames} {thread.snippet ? `— ${thread.snippet}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {thread.messageCount > 1 && (
          <span className="text-[10px] text-muted bg-gray-100 px-1.5 py-0.5 rounded-full font-semibold">
            {thread.messageCount}
          </span>
        )}
        <span className="text-xs text-muted whitespace-nowrap">{dateStr}</span>
      </div>
    </div>
  )
}

function MobileThreadCard({ thread, onClick }: { thread: EmailThread; onClick: () => void }) {
  const date = new Date(thread.lastMessageAt)
  const isToday = new Date().toDateString() === date.toDateString()
  const dateStr = isToday
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const senderNames = thread.participants
    .slice(0, 2)
    .map(p => p.name || p.email.split('@')[0])
    .join(', ')

  return (
    <div onClick={onClick} className={'card p-3.5 cursor-pointer hover:bg-gray-50 transition-colors' + (thread.isUnread ? ' border-l-4 border-l-accent' : '')}>
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className={'text-sm overflow-hidden text-ellipsis whitespace-nowrap ' + (thread.isUnread ? 'font-bold' : 'font-semibold')}>
              {senderNames}
            </span>
            <span className="text-[11px] text-muted whitespace-nowrap flex-shrink-0">{dateStr}</span>
          </div>
          <div className="text-sm text-ink overflow-hidden text-ellipsis whitespace-nowrap">
            {thread.subject || '(no subject)'}
          </div>
          {thread.snippet && (
            <div className="text-xs text-muted mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
              {thread.snippet}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
          {thread.isUnread && <span className="w-2 h-2 rounded-full bg-accent" />}
          {thread.messageCount > 1 && (
            <span className="text-[10px] text-muted bg-gray-100 px-1.5 py-0.5 rounded-full font-semibold">
              {thread.messageCount}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onSync, hasSynced }: { onSync: () => void; hasSynced: boolean }) {
  return (
    <div className="text-center py-12 sm:py-16 text-muted">
      <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24" className="mx-auto mb-3 text-gray-300">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <p className="text-sm mb-3">
        {hasSynced ? 'No email threads found.' : 'Sync your Gmail to get started with Email Intelligence.'}
      </p>
      {!hasSynced && (
        <button onClick={onSync} className="btn btn-primary btn-sm">Sync Emails Now</button>
      )}
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="py-12 sm:py-16 flex justify-center">
      <svg className="animate-spin text-accent" width="24" height="24" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

function MailIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}
