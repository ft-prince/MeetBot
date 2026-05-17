import { Router, Request, Response } from 'express';
import { getMeetingTranscript, getMeetingSummary, listMeetings } from '../services/meetingService';
import { botManager } from '../bot/botManager';

const router = Router();

// Require auth on all /api routes except /health
router.use((req: Request, res: Response, next) => {
  if (req.path === '/health') return next();
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
});

// POST /api/meetings/join
router.post('/meetings/join', async (req: Request, res: Response) => {
  const { meetingUrl } = req.body as { meetingUrl?: string };

  const isGoogleMeet = meetingUrl?.includes('meet.google.com');
  const isZoom = meetingUrl?.match(/zoom\.us\/j\/\d+/i);
  if (!meetingUrl || (!isGoogleMeet && !isZoom)) {
    res.status(400).json({ error: 'Invalid meeting URL — must be a Google Meet or Zoom link' });
    return;
  }

  try {
    const meetingId = await botManager.launch(meetingUrl, req.session.userId);
    res.json({ meetingId, status: 'bot_launching' });
  } catch (err) {
    console.error('[api] join error:', err);
    res.status(500).json({ error: 'Failed to launch bot' });
  }
});

// POST /api/meetings/:code/stop — graceful stop, generates summary
router.post('/meetings/:code/stop', async (req: Request, res: Response) => {
  await botManager.stop(req.params.code);
  res.json({ ok: true });
});

// POST /api/meetings/:code/exit — force-exit, no summary
router.post('/meetings/:code/exit', async (req: Request, res: Response) => {
  await botManager.exit(req.params.code);
  res.json({ ok: true });
});

// GET /api/bots/active — list active bot meeting codes
router.get('/bots/active', (_req: Request, res: Response) => {
  res.json({ active: botManager.active() });
});

// GET /api/meetings
router.get('/meetings', async (req: Request, res: Response) => {
  try {
    res.json({ meetings: await listMeetings(req.session.userId!) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list meetings' });
  }
});

// GET /api/meetings/:id/transcript
router.get('/meetings/:id/transcript', async (req: Request, res: Response) => {
  try {
    const segments = await getMeetingTranscript(req.params.id, req.session.userId);
    if (segments === null) { res.status(403).json({ error: 'Forbidden' }); return; }
    res.json({ segments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get transcript' });
  }
});

// GET /api/meetings/:id/summary
router.get('/meetings/:id/summary', async (req: Request, res: Response) => {
  try {
    const result = await getMeetingSummary(req.params.id, req.session.userId);
    if (!result) { res.status(404).json({ error: 'Meeting not found' }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

router.get('/health', (_req, res) => res.json({ ok: true }));

export default router;