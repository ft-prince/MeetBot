import { useEffect, useRef, useState } from 'react'
import type { AnalysisProgress } from '../lib/types'

interface Props {
  compact?: boolean
}

export function AnalysisProgressPanel({ compact = false }: Props) {
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/emails/analyze-progress/stream', { withCredentials: true })
    esRef.current = es

    es.onmessage = (event) => {
      try {
        const data: AnalysisProgress = JSON.parse(event.data)
        setProgress(data)
      } catch {}
    }

    es.onerror = () => {
      es.close()
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  if (!progress || progress.status === 'idle') return null

  const isRunning = progress.status === 'running'
  const isDone = progress.status === 'completed'
  const elapsed = progress.startedAt ? Math.round((Date.now() - progress.startedAt) / 1000) : 0

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {isRunning && <Spinner />}
        {isDone && <CheckIcon />}
        <span className="text-xs text-muted">
          {isRunning && `Analyzing ${progress.processed}/${progress.total}…`}
          {isDone && `Analyzed ${progress.total} threads`}
        </span>
        {isRunning && (
          <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={
      'card p-4 mb-5 border-l-4 transition-colors '
      + (isRunning ? 'border-l-accent bg-accent/5' : isDone ? 'border-l-emerald-500 bg-emerald-50' : 'border-l-red-500 bg-red-50')
    }>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isRunning && <Spinner />}
          {isDone && <CheckIcon />}
          {progress.status === 'error' && <ErrorIcon />}
          <span className="text-sm font-bold">
            {isRunning && 'Analyzing Emails…'}
            {isDone && 'Analysis Complete'}
            {progress.status === 'error' && 'Analysis Error'}
          </span>
        </div>
        {isRunning && (
          <span className="text-xs text-muted">{elapsed}s elapsed</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden mb-3">
        <div
          className={
            'h-full rounded-full transition-all duration-500 ease-out '
            + (isDone ? 'bg-emerald-500' : 'bg-accent')
          }
          style={{ width: `${progress.percentage}%` }}
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <MiniStat label="Total" value={progress.total} />
        <MiniStat label="Processed" value={progress.processed} valueClass="text-accent" />
        <MiniStat label="Remaining" value={progress.remaining} />
        <MiniStat label="Completed" value={`${progress.percentage}%`} valueClass={isDone ? 'text-emerald-600' : 'text-accent'} />
      </div>

      {/* Current thread being analyzed */}
      {isRunning && progress.currentThread && (
        <div className="mt-3 flex items-center gap-1.5">
          <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Now analyzing:</span>
          <span className="text-xs text-ink truncate">{progress.currentThread}</span>
        </div>
      )}

      {/* Errors */}
      {progress.errors > 0 && (
        <div className="mt-2 text-xs text-amber-700">
          {progress.errors} thread{progress.errors !== 1 ? 's' : ''} failed — skipped and continued.
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, valueClass = '' }: { label: string; value: number | string; valueClass?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</div>
      <div className={'text-lg font-extrabold leading-tight ' + valueClass}>{value}</div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin text-accent" width="16" height="16" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="#059669" strokeWidth="2.5" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="#DC2626" strokeWidth="2.5" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
