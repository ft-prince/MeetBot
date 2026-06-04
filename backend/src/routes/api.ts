import { Router, Request, Response } from 'express';
import { getMeetingTranscript, getMeetingSummary, listMeetings, getMeetingIdByCode } from '../services/meetingService';
import {
  createScheduledMeeting,
  listScheduledMeetings,
  cancelScheduledMeeting,
  getScheduledMeeting,
  markScheduledLaunched,
  validateScheduleInput,
} from '../services/scheduledMeetingService';
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

  const isValidUrl = meetingUrl && (
    meetingUrl.includes('meet.google.com') ||
    /zoom\.us\/(j|wc\/join)\/\d+/.test(meetingUrl) ||
    /teams\.microsoft\.com|teams\.live\.com/.test(meetingUrl)
  );
  if (!isValidUrl) {
    res.status(400).json({ error: 'Invalid meeting URL. Use a Google Meet, Zoom, or Microsoft Teams link.' });
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
    console.error('[api] /meetings/:id/summary failed:', err);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// ── Scheduled Meetings ───────────────────────────────────────────────────────

// POST /api/meetings/schedule — user-created scheduled meeting
router.post('/meetings/schedule', async (req: Request, res: Response) => {
  const body = req.body as {
    title?: string;
    meetingUrl?: string;
    scheduledFor?: string;
    description?: string;
    autoLaunch?: boolean;
  };
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : undefined;
  const input = {
    title: body.title ?? '',
    meetingUrl: body.meetingUrl ?? '',
    scheduledFor: scheduledFor as Date,
    description: body.description,
    autoLaunch: body.autoLaunch,
  };
  const error = validateScheduleInput(input);
  if (error) { res.status(400).json({ error }); return; }
  try {
    const created = await createScheduledMeeting(req.session.userId!, input);
    res.json({ scheduledMeeting: created });
  } catch (err) {
    console.error('[api] schedule error:', err);
    res.status(500).json({ error: 'Failed to schedule meeting' });
  }
});

// GET /api/meetings/scheduled — list user's scheduled meetings
router.get('/meetings/scheduled', async (req: Request, res: Response) => {
  try {
    const scheduled = await listScheduledMeetings(req.session.userId!);
    res.json({ scheduled });
  } catch (err) {
    console.error('[api] list scheduled error:', err);
    res.status(500).json({ error: 'Failed to list scheduled meetings' });
  }
});

// DELETE /api/meetings/scheduled/:id — cancel a scheduled meeting
router.delete('/meetings/scheduled/:id', async (req: Request, res: Response) => {
  try {
    const ok = await cancelScheduledMeeting(req.params.id, req.session.userId!);
    if (!ok) { res.status(404).json({ error: 'Not found or already launched' }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error('[api] cancel scheduled error:', err);
    res.status(500).json({ error: 'Failed to cancel scheduled meeting' });
  }
});

// POST /api/meetings/scheduled/:id/start — manual launch (start early)
router.post('/meetings/scheduled/:id/start', async (req: Request, res: Response) => {
  try {
    const scheduled = await getScheduledMeeting(req.params.id, req.session.userId!);
    if (!scheduled) { res.status(404).json({ error: 'Not found' }); return; }
    if (scheduled.status !== 'scheduled') {
      res.status(400).json({ error: `Meeting is ${scheduled.status}, cannot start` });
      return;
    }
    // botManager.launch returns the meeting *code* (e.g. "abc-defg-hij"), not the
    // DB UUID. The UUID is created inside createBotSession during launch; resolve
    // it now so we can link the scheduled row to the actual meeting.
    const meetingCode = await botManager.launch(scheduled.meetingUrl, req.session.userId!);
    const dbMeetingId = await getMeetingIdByCode(meetingCode, req.session.userId!);
    await markScheduledLaunched(scheduled.id, dbMeetingId);
    res.json({ meetingId: meetingCode });
  } catch (err) {
    console.error('[api] manual start error:', err);
    res.status(500).json({ error: 'Failed to start scheduled meeting' });
  }
});

router.get('/health', (_req, res) => res.json({ ok: true }));

export default router;