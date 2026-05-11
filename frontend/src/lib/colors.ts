import type { SpeakerColor } from './types'

export const SPEAKER_COLORS: SpeakerColor[] = [
  { bg: '#EDE9FE', text: '#5B21B6', border: '#8B5CF6' },
  { bg: '#D1FAE5', text: '#065F46', border: '#10B981' },
  { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B' },
  { bg: '#FCE7F3', text: '#9D174D', border: '#EC4899' },
  { bg: '#DBEAFE', text: '#1E40AF', border: '#3B82F6' },
  { bg: '#FEE2E2', text: '#991B1B', border: '#EF4444' },
]

export function colorMapFor(names: string[]): Record<string, SpeakerColor> {
  const m: Record<string, SpeakerColor> = {}
  let i = 0
  for (const n of names) if (!m[n]) { m[n] = SPEAKER_COLORS[i++ % SPEAKER_COLORS.length] }
  return m
}
