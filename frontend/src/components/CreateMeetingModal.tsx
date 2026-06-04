import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const MEET_URL_RE  = /^https?:\/\/meet\.google\.com\/[a-z0-9-]+/i
const ZOOM_URL_RE  = /^https?:\/\/[a-z0-9.-]*zoom\.us\/(j|wc\/join)\/\d+/i
const TEAMS_URL_RE = /^https?:\/\/(teams\.microsoft\.com|teams\.live\.com)\//i

function detectPlatform(url: string): 'meet' | 'zoom' | 'teams' | null {
  if (MEET_URL_RE.test(url)) return 'meet'
  if (ZOOM_URL_RE.test(url)) return 'zoom'
  if (TEAMS_URL_RE.test(url)) return 'teams'
  return null
}

function isValidMeetingUrl(url: string): boolean {
  return MEET_URL_RE.test(url) || ZOOM_URL_RE.test(url) || TEAMS_URL_RE.test(url)
}

function toLocalISO(date: string, time: string): string | null {
  if (!date || !time) return null
  const d = new Date(`${date}T${time}`)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

function defaultDateTime(): { date: string; time: string } {
  const d = new Date(Date.now() + 30 * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export function CreateMeetingModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [meetingUrl, setMeetingUrl] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [description, setDescription] = useState('')
  const [autoLaunch, setAutoLaunch] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const def = defaultDateTime()
    setTitle('')
    setMeetingUrl('')
    setDate(def.date)
    setTime(def.time)
    setDescription('')
    setAutoLaunch(true)
    setError(null)
    setSubmitting(false)
    setTimeout(() => titleRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const submit = async () => {
    if (!title.trim()) return setError('Title is required')
    if (!isValidMeetingUrl(meetingUrl.trim())) return setError('Enter a valid Google Meet, Zoom, or Microsoft Teams link')
    const scheduledFor = toLocalISO(date, time)
    if (!scheduledFor) return setError('Pick a valid date and time')
    if (new Date(scheduledFor).getTime() < Date.now() - 60_000) {
      return setError('Scheduled time must be in the future')
    }
    setError(null)
    setSubmitting(true)
    try {
      await api.scheduleMeeting({
        title: title.trim(),
        meetingUrl: meetingUrl.trim(),
        scheduledFor,
        description: description.trim() || undefined,
        autoLaunch,
      })
      onCreated()
      onClose()
    } catch (err) {
      setError((err as Error).message || 'Failed to schedule meeting')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <svg width="18" height="18" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Schedule a Meeting
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink p-1 rounded transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3.5">
          <Field label="Title" required>
            <input
              ref={titleRef}
              className="input"
              type="text"
              placeholder="Weekly Engineering Sync"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
            />
          </Field>

          <Field label="Meeting Link" required>
            <div className="relative">
              <input
                className="input pr-20"
                type="url"
                placeholder="Google Meet, Zoom, or Teams link"
                value={meetingUrl}
                onChange={e => setMeetingUrl(e.target.value)}
              />
              {detectPlatform(meetingUrl.trim()) && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 pointer-events-none">
                  {detectPlatform(meetingUrl.trim()) === 'zoom' ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="#2D8CFF"><rect width="24" height="24" rx="4" fill="#2D8CFF"/><path d="M15 9.5v5l3.5 2V7.5L15 9.5zM5 8a1 1 0 011-1h8a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1V8z" fill="white"/></svg>
                      Zoom
                    </>
                  ) : detectPlatform(meetingUrl.trim()) === 'teams' ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#5059C9"/><circle cx="16.5" cy="7.5" r="2.5" fill="white"/><rect x="4" y="8" width="9" height="9" rx="1.5" fill="white"/><path d="M5.5 10.5h6M8.5 10.5V15" stroke="#5059C9" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      Teams
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#34A853"/><path d="M8 12l2.5 2.5L16 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Meet
                    </>
                  )}
                </span>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <input
                className="input"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </Field>
            <Field label="Time" required>
              <input
                className="input"
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Description" hint="Optional">
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Agenda, notes for the bot, anything useful…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={2000}
            />
          </Field>

          <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoLaunch}
              onChange={e => setAutoLaunch(e.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-gray-700">
              Auto-launch the recording bot at the scheduled time
            </span>
          </label>

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-gray-200 bg-app-bg flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting} className="btn btn-primary btn-sm">
            {submitting ? 'Scheduling…' : 'Schedule Meeting'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
        {hint && <span className="text-muted font-normal ml-1.5">{hint}</span>}
      </label>
      {children}
    </div>
  )
}