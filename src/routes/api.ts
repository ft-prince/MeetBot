import { Router, Request, Response } from 'express'
import { getMeetingTranscript, listMeetings } from '../services/meetingService'
import { botManager } from '../bot/botManager'

const router = Router()

// POST /api/meetings/join — user pastes Meet link, we launch a bot
router.post('/meetings/join', async (req: Request, res: Response) => {
  const { meetingUrl } = req.body as { meetingUrl?: string }

  if (!meetingUrl || !meetingUrl.includes('meet.google.com')) {
    res.status(400).json({ error: 'Invalid Google Meet URL' })
    return
  }

  try {
    const meetingId = await botManager.launch(meetingUrl)
    res.json({ meetingId, status: 'bot_launching' })
  } catch (err) {
    console.error('[api] join error:', err)
    res.status(500).json({ error: 'Failed to launch bot' })
  }
})

// POST /api/meetings/:id/stop — stop the bot for a meeting
router.post('/meetings/:id/stop', async (req: Request, res: Response) => {
  await botManager.stop(req.params.id)
  res.json({ ok: true })
})

// GET /api/meetings
router.get('/meetings', async (_req: Request, res: Response) => {
  try {
    res.json({ meetings: await listMeetings() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to list meetings' })
  }
})

// GET /api/meetings/:id/transcript
router.get('/meetings/:id/transcript', async (req: Request, res: Response) => {
  try {
    res.json({ segments: await getMeetingTranscript(req.params.id) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get transcript' })
  }
})

router.get('/health', (_req, res) => res.json({ ok: true }))

export default router
