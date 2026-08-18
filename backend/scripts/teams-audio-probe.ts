/**
 * Diagnostic: joins a Teams meeting and reports whether audio actually reaches
 * Node from the in-page injector. Forwards the page console so the injector's
 * own [NoteAI] lines are visible, and counts bytes per track.
 *
 * Usage: npx tsx scripts/teams-audio-probe.ts <teams-url>
 * ponytail: throwaway probe — delete once the capture path is trusted.
 */
import '../src/config'
import { TeamsBot } from '../src/bot/teamsBot'

const url = process.argv[2]
if (!url) { console.error('need a meeting url'); process.exit(1) }

const bytesByTrack = new Map<string, number>()
let callbacks = 0

const bot = new TeamsBot()

// Surface the injector's page-console output, which the normal bot swallows.
const origStart = bot.start.bind(bot)
;(bot as any).start = async (opts: any) => {
  const p = origStart(opts)
  const iv = setInterval(() => {
    const page = (bot as any).page
    if (page && !(page as any).__probed) {
      ;(page as any).__probed = true
      page.on('console', (m: any) => {
        const t = m.text()
        if (t.includes('[NoteAI]')) console.log('  PAGE ▸', t.slice(0, 160))
      })
      page.on('pageerror', (e: any) => console.log('  PAGE ERR ▸', String(e).slice(0, 160)))
      clearInterval(iv)
    }
  }, 200)
  return p
}

setInterval(() => {
  const total = [...bytesByTrack.values()].reduce((a, b) => a + b, 0)
  console.log(`[probe] callbacks=${callbacks} totalBytes=${total} tracks=${bytesByTrack.size}` +
    (bytesByTrack.size ? ' :: ' + [...bytesByTrack].map(([t, b]) => `${t.slice(0, 10)}=${b}`).join(' ') : ''))
}, 5000)

bot.start({
  meetingUrl: url,
  displayName: 'MeetMaster Recorder',
  onJoined: () => console.log('[probe] JOINED — speak now'),
  onTrackAudio: (buf: Buffer, trackId: string) => {
    callbacks++
    bytesByTrack.set(trackId, (bytesByTrack.get(trackId) || 0) + buf.length)
  },
  onTrackInfo: (id: string, name: string) => console.log(`[probe] trackInfo ${id.slice(0, 10)} -> ${name}`),
  onParticipants: (n: string[]) => console.log('[probe] participants:', n.join(', ')),
  onError: (e: Error) => console.error('[probe] ERROR', e.message),
} as any).catch(e => console.error('[probe] start failed', e))

process.on('SIGINT', async () => { await bot.stop(); process.exit(0) })
