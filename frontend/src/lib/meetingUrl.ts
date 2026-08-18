// Normalize whatever a user pastes into a meeting input into a valid join URL.
// Accepts: full Google Meet/Zoom/Teams URLs (with or without https://), and bare
// Google Meet codes like "abc-defg-hij". Returns a clean URL or a clear error.

export interface NormalizedMeeting {
  url: string | null
  error: string | null
}

// A Google Meet code is three letters, four letters, three letters.
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i
const MEET_CODE_ANYWHERE = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i

export function normalizeMeetingUrl(raw: string): NormalizedMeeting {
  let s = (raw || '').trim()
  if (!s) return { url: null, error: 'Please enter a meeting link or code.' }

  // Bare Google Meet code → full URL (the most common shortcut).
  if (MEET_CODE.test(s)) {
    return { url: `https://meet.google.com/${s.toLowerCase()}`, error: null }
  }

  // Add a scheme when the user omitted it (e.g. "meet.google.com/abc-defg-hij").
  if (!/^https?:\/\//i.test(s)) {
    if (/^(www\.)?(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i.test(s)) {
      s = 'https://' + s.replace(/^www\./i, '')
    }
  }

  // Recover a Meet code embedded anywhere (handles odd paste formats / typos).
  const embedded = s.match(MEET_CODE_ANYWHERE)
  if (embedded) {
    // Preserve query string (e.g. ?authuser=) if the input already had a scheme.
    const qs = s.match(/[?#].*$/)?.[0] ?? ''
    return { url: `https://meet.google.com/${embedded[1].toLowerCase()}${qs}`, error: null }
  }

  const valid =
    /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(s) ||
    /zoom\.us\/(j|wc\/join)\/\d+/i.test(s) ||
    /teams\.(microsoft|live)\.com\//i.test(s)

  if (!valid) {
    return {
      url: null,
      error: 'Enter a valid Google Meet link or code (e.g. abc-defg-hij), or a Zoom/Teams link.',
    }
  }
  return { url: s, error: null }
}
