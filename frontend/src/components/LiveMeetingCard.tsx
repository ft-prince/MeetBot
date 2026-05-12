import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LiveMeeting } from '../hooks/useLiveMeetings'
import { useLiveMeetings } from '../hooks/useLiveMeetings'
import { fmtClock, initials } from '../lib/format'

export function LiveMeetingCard({ meeting }: { meeting: LiveMeeting }) {
  const { stop } = useLiveMeetings()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [meeting.segments.length])

  const dotClass =
    meeting.status === 'live' ? 'bg-emerald-500 shadow-[0_0_6px_#10B981] animate-pulse-slow' :
    meeting.status === 'joining' || meeting.status === 'connecting' ? 'bg-warning animate-pulse-slow' :
    meeting.status === 'error' ? 'bg-danger' :
    'bg-gray-300'

  const fmtLine = (s: { speakerName: string | null; speakerLabel: string | null; text: string; startMs: number }) => {
    const spk = s.speakerName || s.speakerLabel || "?"
    return "[" + fmtClock(s.startMs) + "] " + spk + ": " + s.text
  }

  const copy = () => {
    const text = meeting.segments.map(fmtLine).join("\n")
    navigator.clipboard.writeText(text).catch(() => {})
  }

  const exportTxt = () => {
    const text = meeting.segments.map(fmtLine).join("\n")
    const anchor = document.createElement("a")
    anchor.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
    anchor.download = "transcript-" + meeting.id + ".txt"
    anchor.click()
  }

  const handleStop = async () => {
    setStopping(true)
    setStopError(null)
    const dbId = await stop(meeting.id)
    if (dbId) {
      navigate("/meetings/" + dbId)
    } else {
      setStopping(false)
      setStopError('Could not get meeting record — check the Meetings page.')
    }
  }

  const interimColor = meeting.interim && meeting.speakerColors[meeting.interim.speaker]

  return (
    <div className="bg-white border-[1.5px] border-gray-200 rounded-xl flex flex-col max-h-[580px] overflow-hidden shadow-card">
      <div className="px-4 py-3 bg-app-bg border-b border-gray-200 flex items-center gap-2">
        <span className={"w-2 h-2 rounded-full flex-shrink-0 " + dotClass} />
        <span className="text-xs font-bold text-accent flex-1 font-mono">{meeting.id}</span>
        <span className="text-[11px] text-muted">{meeting.statusText}</span>
      </div>
      <div className="px-4 py-2 bg-orange-50 border-b border-orange-100 flex items-center gap-2 text-xs min-h-[34px] flex-shrink-0">
        <span className="font-bold" style={{ color: interimColor?.text || "#F06428" }}>
          {meeting.interim?.speaker || "—"}
        </span>
        <span className="text-muted italic flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{meeting.interim?.text || ""}</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {meeting.segments.length === 0 ? (
          <div className="text-gray-300 text-xs text-center py-8">Waiting for speech…</div>
        ) : meeting.segments.map(s => {
          const name = s.speakerName || s.speakerLabel || "?"
          const c = meeting.speakerColors[name] || { bg: "#F3F4F6", text: "#374151", border: "#9CA3AF" }
          return (
            <div key={s.id} className="bg-app-bg rounded-r-md border-l-[3px] px-2.5 py-1.5" style={{ borderLeftColor: c.border }}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className="w-5 h-5 rounded-full text-[8px] font-bold flex items-center justify-center" style={{ background: c.bg, color: c.text }}>
                  {initials(name)}
                </div>
                <span className="font-semibold text-[11px]" style={{ color: c.text }}>{name}</span>
                <span className="text-[10px] text-muted ml-auto">{fmtClock(s.startMs)}</span>
              </div>
              <div className="text-gray-700 text-xs leading-relaxed">{s.text}</div>
            </div>
          )
        })}
      </div>

      {meeting.summary && (
        <div className="px-4 py-3 bg-orange-50 border-t border-orange-100 max-h-44 overflow-y-auto">
          <div className="text-[11px] font-bold text-accent mb-1.5">AI Summary</div>
          <div className="text-xs leading-relaxed mb-2">{meeting.summary.text}</div>
          {meeting.summary.insights.length > 0 && (
            <>
              <div className="text-[11px] font-bold text-accent mb-1">Key Insights</div>
              <ul className="space-y-1">
                {meeting.summary.insights.map((insight, k) => (
                  <li key={k} className="text-[11px] text-muted flex items-start gap-1 leading-relaxed">
                    <span className="text-accent">&#x2192;</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {stopError && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-danger">{stopError}</div>
      )}

      <div className="px-4 py-2 bg-app-bg border-t border-gray-200 flex gap-1.5 flex-wrap flex-shrink-0">
        <button onClick={handleStop} disabled={stopping} className="btn btn-danger btn-sm">
          {stopping ? "Stopping…" : "Stop & Leave"}
        </button>
        <button onClick={copy} className="btn btn-secondary btn-sm">Copy Transcript</button>
        <button onClick={exportTxt} className="btn btn-secondary btn-sm">Export .txt</button>
      </div>
    </div>
  )
}