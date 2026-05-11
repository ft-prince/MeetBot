export function fmtDate(dt: string | Date): string {
  return new Date(dt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function fmtTimeOfDay(dt: string | Date): string {
  return new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return '—'
  const m = Math.floor(ms / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function initials(name: string | null | undefined): string {
  if (!name || name.startsWith('SPEAKER') || (name.length < 3 && name === name.toUpperCase())) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export function timeUntil(dt: string | Date): string {
  const target = new Date(dt).getTime()
  const diffMs = target - Date.now()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 0) return 'past'
  if (diffMin < 60) return `in ${diffMin}m`
  if (diffMs < 86_400_000) return fmtTimeOfDay(dt)
  return fmtDate(dt)
}
