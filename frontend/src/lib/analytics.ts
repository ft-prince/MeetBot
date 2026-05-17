/**
 * Client-side analytics derived from transcript segments.
 * Computed live from data we already have — once Phase 1 (AI pipeline) ships,
 * these can be augmented with server-side LLM-derived insights.
 */
import type { TranscriptSegment } from './types'

export interface SpeakerStats {
  name: string
  segments: number
  words: number
  speakingMs: number
  pctTime: number
  pctWords: number
  firstAt: number
  lastAt: number
}

export interface MeetingAnalytics {
  totalSegments: number
  totalWords: number
  totalSpeakingMs: number
  speakers: SpeakerStats[]
  mostActive: SpeakerStats | null
  participantCount: number
  avgWordsPerSegment: number
  wpm: number
}

const wordsOf = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length

const nameOf = (s: TranscriptSegment): string =>
  s.speaker_name || s.speaker_label || 'Unknown'

export function computeAnalytics(
  segments: TranscriptSegment[],
  durationMs: number | null,
): MeetingAnalytics {
  if (segments.length === 0) {
    return {
      totalSegments: 0,
      totalWords: 0,
      totalSpeakingMs: 0,
      speakers: [],
      mostActive: null,
      participantCount: 0,
      avgWordsPerSegment: 0,
      wpm: 0,
    }
  }

  const byName = new Map<string, SpeakerStats>()

  for (const seg of segments) {
    const name = nameOf(seg)
    const w = wordsOf(seg.text)
    const segMs = Math.max(0, (seg.end_ms ?? 0) - (seg.start_ms ?? 0))

    const existing = byName.get(name) ?? {
      name,
      segments: 0,
      words: 0,
      speakingMs: 0,
      pctTime: 0,
      pctWords: 0,
      firstAt: seg.start_ms ?? 0,
      lastAt: seg.end_ms ?? 0,
    }

    byName.set(name, {
      ...existing,
      segments: existing.segments + 1,
      words: existing.words + w,
      speakingMs: existing.speakingMs + segMs,
      firstAt: Math.min(existing.firstAt, seg.start_ms ?? 0),
      lastAt: Math.max(existing.lastAt, seg.end_ms ?? 0),
    })
  }

  const totalWords = Array.from(byName.values()).reduce((s, x) => s + x.words, 0)
  const totalSpeakingMs = Array.from(byName.values()).reduce((s, x) => s + x.speakingMs, 0)

  const speakers = Array.from(byName.values())
    .map(s => ({
      ...s,
      pctTime: totalSpeakingMs > 0 ? (s.speakingMs / totalSpeakingMs) * 100 : 0,
      pctWords: totalWords > 0 ? (s.words / totalWords) * 100 : 0,
    }))
    .sort((a, b) => b.speakingMs - a.speakingMs)

  const denom = durationMs && durationMs > 0 ? durationMs : totalSpeakingMs
  const wpm = denom > 0 ? Math.round(totalWords / (denom / 60_000)) : 0

  return {
    totalSegments: segments.length,
    totalWords,
    totalSpeakingMs,
    speakers,
    mostActive: speakers[0] ?? null,
    participantCount: speakers.length,
    avgWordsPerSegment: segments.length ? Math.round(totalWords / segments.length) : 0,
    wpm,
  }
}