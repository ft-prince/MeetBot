/**
 * Quick sanity-check for the Google Meet API credentials.
 * Tests: OAuth flow → spaces → conference records → transcripts → participants.
 *
 * Usage:
 *   npx tsx test-meet-api.ts
 *
 * Needs in .env:
 *   GOOGLE_MEET_CLIENT_ID=...
 *   GOOGLE_MEET_CLIENT_SECRET=...
 */

import 'dotenv/config'
import http from 'http'
import { google } from 'googleapis'
import { exec } from 'child_process'

// ── Config ────────────────────────────────────────────────────────────────────

const CLIENT_ID     = process.env.GOOGLE_MEET_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID     || ''
const CLIENT_SECRET = process.env.GOOGLE_MEET_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || ''
const REDIRECT_PORT = 9876
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/oauth2callback`

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_MEET_CLIENT_ID or GOOGLE_MEET_CLIENT_SECRET in .env')
  process.exit(1)
}

const SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.conference.media.audio.readonly',
  'openid',
  'email',
]

// ── OAuth ─────────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })

  console.log('\n[auth] Opening browser for Google consent...')
  console.log('[auth] If it doesn\'t open, go to:\n', authUrl, '\n')
  exec(`open "${authUrl}"`)   // macOS; swap for `start` on Windows, `xdg-open` on Linux

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/oauth2callback')) return
      const code = new URL(req.url, `http://localhost:${REDIRECT_PORT}`).searchParams.get('code')
      res.end('<h2>Authorised! You can close this tab.</h2>')
      server.close()
      if (!code) return reject(new Error('No code returned'))
      const { tokens } = await oauth2.getToken(code)
      oauth2.setCredentials(tokens)
      resolve(tokens.access_token!)
    })
    server.listen(REDIRECT_PORT, () =>
      console.log(`[auth] Waiting for callback on :${REDIRECT_PORT} ...`)
    )
  })
}

// ── API helpers ───────────────────────────────────────────────────────────────

function log(section: string, data: unknown) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[${section}]`)
  console.log(JSON.stringify(data, null, 2))
}

async function run() {
  const token = await getAccessToken()
  console.log('\n[auth] ✅ Got access token\n')

  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
  auth.setCredentials({ access_token: token })
  const meet = google.meet({ version: 'v2', auth })

  // 1 ── Spaces (meetings the user has created/owns)
  try {
    const res = await meet.spaces.list({} as any)
    const spaces = (res.data as any).spaces || []
    log('spaces.list', { count: spaces.length, sample: spaces.slice(0, 3) })
  } catch (e: any) {
    log('spaces.list ERROR', e.message)
  }

  // 2 ── Conference records (past & in-progress meetings)
  let conferenceRecordName: string | undefined
  try {
    const res = await meet.conferenceRecords.list({ pageSize: 5 })
    const records = res.data.conferenceRecords || []
    conferenceRecordName = records[0]?.name ?? undefined
    log('conferenceRecords.list', {
      count: records.length,
      records: records.map(r => ({
        name: r.name,
        startTime: r.startTime,
        endTime: r.endTime,
        space: r.space,
      })),
    })
  } catch (e: any) {
    log('conferenceRecords.list ERROR', e.message)
  }

  if (!conferenceRecordName) {
    console.log('\n[info] No conference records found — start a test meeting and rejoin.')
    return
  }

  // 3 ── Participants in the most recent record
  try {
    const res = await meet.conferenceRecords.participants.list({
      parent: conferenceRecordName,
    })
    log('participants.list', res.data)
  } catch (e: any) {
    log('participants.list ERROR', e.message)
  }

  // 4 ── Transcripts (requires host to have enabled Meet transcription)
  try {
    const res = await meet.conferenceRecords.transcripts.list({
      parent: conferenceRecordName,
    })
    const transcripts = res.data.transcripts || []
    log('transcripts.list', { count: transcripts.length, transcripts })

    // Pull first 5 transcript entries if any exist
    if (transcripts[0]?.name) {
      const entries = await meet.conferenceRecords.transcripts.entries.list({
        parent: transcripts[0].name,
        pageSize: 5,
      })
      log('transcripts.entries (first 5)', entries.data)
    }
  } catch (e: any) {
    log('transcripts.list ERROR', e.message)
  }

  // 5 ── Recordings
  try {
    const res = await meet.conferenceRecords.recordings.list({
      parent: conferenceRecordName,
    })
    log('recordings.list', res.data)
  } catch (e: any) {
    log('recordings.list ERROR', e.message)
  }

  console.log('\n[done] Scope for real-time audio (meetings.conference.media.audio.readonly)')
  console.log('       This scope uses the Meet Media API (WebRTC-based), not REST.')
  console.log('       See: https://developers.google.com/meet/media-api\n')
}

run().catch(err => { console.error(err); process.exit(1) })
