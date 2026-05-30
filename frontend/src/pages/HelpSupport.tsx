import { useState } from 'react'
import { Topbar } from '../components/Topbar'
import { api } from '../lib/api'

const ISSUE_OPTIONS = [
  { value: '',                       label: 'Select an issue type…' },
  { value: 'bot-unable-to-join',     label: 'Bot unable to join meeting' },
  { value: 'bot-joined-no-record',   label: 'Bot joined but didn\'t record' },
  { value: 'auto-join-failed',       label: 'Auto-join didn\'t work' },
  { value: 'transcript-not-generated', label: 'Transcript not generated' },
  { value: 'summary-missing',        label: 'AI summary missing' },
  { value: 'other',                  label: 'Other issue' },
]

type State = 'idle' | 'sending' | 'sent' | 'error'

export function HelpSupport() {
  const [issueType, setIssueType] = useState('')
  const [message, setMessage]     = useState('')
  const [state, setState]         = useState<State>('idle')
  const [errorMsg, setErrorMsg]   = useState('')

  const canSubmit = issueType !== '' && message.trim().length > 0 && state !== 'sending'

  const submit = async () => {
    if (!canSubmit) return
    setState('sending')
    setErrorMsg('')
    try {
      await api.submitSupport(issueType, message.trim())
      setState('sent')
      setIssueType('')
      setMessage('')
    } catch (err) {
      setState('error')
      setErrorMsg((err as Error).message || 'Something went wrong. Please try again.')
    }
  }

  return (
    <>
      <Topbar title="Help & Support" subtitle="Report an issue or ask a question" />
      <div className="p-4 sm:p-8 flex-1">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">

          {/* Header card */}
          <div className="card p-5 sm:p-6 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="20" height="20" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold mb-1">Having an issue?</h2>
              <p className="text-xs text-muted leading-relaxed">
                Tell us what went wrong. Select the issue type, describe the problem, and hit Send — we'll look into it right away.
              </p>
            </div>
          </div>

          {/* Success state */}
          {state === 'sent' ? (
            <div className="card p-8 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg width="28" height="28" fill="none" stroke="#059669" strokeWidth="2.5" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-base font-bold text-ink">Message sent!</div>
              <p className="text-sm text-muted max-w-xs">
                Thanks for reaching out. We've received your report and will follow up shortly.
              </p>
              <button
                onClick={() => setState('idle')}
                className="btn btn-secondary btn-sm mt-2"
              >
                Send another message
              </button>
            </div>
          ) : (
            /* Form card */
            <div className="card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-200 bg-app-bg text-sm font-bold flex items-center gap-2">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Submit a support request
              </div>

              <div className="px-5 py-5 flex flex-col gap-5">
                {/* Issue type dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Issue type <span className="text-danger">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={issueType}
                      onChange={e => setIssueType(e.target.value)}
                      disabled={state === 'sending'}
                      className="input w-full appearance-none pr-9 cursor-pointer"
                    >
                      {ISSUE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value} disabled={o.value === ''}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Message box */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Describe the issue <span className="text-danger">*</span>
                  </label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    disabled={state === 'sending'}
                    placeholder="Any issue? Tell us what happened, what you expected, and what you saw instead…"
                    rows={6}
                    maxLength={5000}
                    className="input resize-none w-full"
                  />
                  <div className="flex justify-end mt-1">
                    <span className="text-[11px] text-muted">{message.length} / 5000</span>
                  </div>
                </div>

                {/* Error message */}
                {state === 'error' && errorMsg && (
                  <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-danger flex items-start gap-2">
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="flex-shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {errorMsg}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-gray-200 bg-app-bg flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] text-muted">
                  Your user account details are included automatically so we can look up your session.
                </p>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="btn btn-primary flex items-center gap-2 flex-shrink-0"
                >
                  {state === 'sending' ? (
                    <>
                      <svg className="animate-spin" width="14" height="14" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Sending…
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                      Send Message
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}