import { Router, Request, Response } from 'express';
import {
  getMeetingTranscript,
  getMeetingSummary,
  listMeetings,
  getMeetingIdByCode,
  markMeetingViewed,
  getMeetingReportData,
  updateMeetingTitle,
} from '../services/meetingService';
import { generateMeetingPdf } from '../services/pdfService';
import {
  createScheduledMeeting,
  listScheduledMeetings,
  cancelScheduledMeeting,
  getScheduledMeeting,
  markScheduledLaunched,
  validateScheduleInput,
} from '../services/scheduledMeetingService';
import { botManager } from '../bot/botManager';
import { QuotaError, getUsage } from '../services/planService';

const router = Router();

// A plan limit is a client-fixable condition, not a server fault: answer 402 with
// the human-readable reason so the UI can show an upgrade prompt.
function sendIfQuotaError(res: Response, err: unknown): boolean {
  if (!(err instanceof QuotaError)) return false;
  res.status(err.status).json({ error: err.message, plan: err.plan, limit: err.limit });
  return true;
}

// Normalize a user-supplied meeting reference into a join URL. Accepts a bare
// Google Meet code ("abc-defg-hij"), scheme-less links ("meet.google.com/..."),
// and full URLs. Mirrors the frontend normalizer so the API is robust even when
// called directly. Returns null if it isn't a recognizable meeting link.
function normalizeMeetingUrl(raw?: string): string | null {
  let s = (raw || '').trim();
  if (!s) return null;
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(s)) return `https://meet.google.com/${s.toLowerCase()}`;
  if (!/^https?:\/\//i.test(s) &&
      /^(www\.)?(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i.test(s)) {
    s = 'https://' + s.replace(/^www\./i, '');
  }
  const embedded = s.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  if (embedded) {
    const qs = s.match(/[?#].*$/)?.[0] ?? '';
    return `https://meet.google.com/${embedded[1].toLowerCase()}${qs}`;
  }
  const valid =
    /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(s) ||
    /zoom\.us\/(j|wc\/join)\/\d+/i.test(s) ||
    /teams\.(microsoft|live)\.com\//i.test(s);
  return valid ? s : null;
}

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
  const { meetingUrl, title } = req.body as { meetingUrl?: string; title?: string };

  const normalized = normalizeMeetingUrl(meetingUrl);
  if (!normalized) {
    res.status(400).json({ error: 'Invalid meeting link. Use a Google Meet link or code (abc-defg-hij), or a Zoom/Teams link.' });
    return;
  }

  // Title is optional — a blank one lets createMeeting generate the dated default.
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 200) : undefined;

  try {
    const meetingId = await botManager.launch(normalized, req.session.userId, cleanTitle || undefined);
    res.json({ meetingId, status: 'bot_launching' });
  } catch (err) {
    if (sendIfQuotaError(res, err)) return;
    console.error('[api] join error:', err);
    res.status(500).json({ error: 'Failed to launch bot' });
  }
});

// PATCH /api/meetings/:id/title — rename a meeting (owner only)
router.patch('/meetings/:id/title', async (req: Request, res: Response) => {
  const { title } = req.body as { title?: string };
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  try {
    const saved = await updateMeetingTitle(req.params.id, req.session.userId!, title);
    if (saved === null) { res.status(404).json({ error: 'Meeting not found' }); return; }
    res.json({ title: saved });
  } catch (err) {
    console.error('[api] update title error:', err);
    res.status(500).json({ error: 'Failed to update title' });
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

// GET /api/bots/active — list THIS USER's active bot meeting codes only.
// Scoped by userId so one user can never discover/subscribe to another user's
// live meeting (the cross-user live-transcript leak).
router.get('/bots/active', (req: Request, res: Response) => {
  res.json({ active: botManager.active(req.session.userId) });
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
    // The owner opening a meeting in the dashboard marks it as viewed, which
    // stops unread-meeting reminder emails. Fire-and-forget; idempotent.
    markMeetingViewed(req.params.id, req.session.userId!).catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('[api] /meetings/:id/summary failed:', err);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// GET /api/meetings/:id/report.pdf — professional PDF report download
router.get('/meetings/:id/report.pdf', async (req: Request, res: Response) => {
  try {
    // Ownership check via the same path the summary uses.
    const owned = await getMeetingSummary(req.params.id, req.session.userId);
    if (!owned) { res.status(404).json({ error: 'Meeting not found' }); return; }
    const data = await getMeetingReportData(req.params.id);
    if (!data) { res.status(404).json({ error: 'Meeting not found' }); return; }
    const pdf = await generateMeetingPdf(data);
    const safeTitle = (data.title || data.meetingCode).replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Meeting Report - ${safeTitle}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('[api] /meetings/:id/report.pdf failed:', err);
    res.status(500).json({ error: 'Failed to generate PDF report' });
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
  // Normalize the same way Quick Join does, so a bare Meet code or scheme-less
  // link is accepted here too. Falls back to the raw input so the validator can
  // produce the proper error for genuinely invalid links.
  const input = {
    title: body.title ?? '',
    meetingUrl: normalizeMeetingUrl(body.meetingUrl) ?? body.meetingUrl ?? '',
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
    const meetingCode = await botManager.launch(scheduled.meetingUrl, req.session.userId!, scheduled.title);
    const dbMeetingId = await getMeetingIdByCode(meetingCode, req.session.userId!);
    await markScheduledLaunched(scheduled.id, dbMeetingId);
    res.json({ meetingId: meetingCode });
  } catch (err) {
    if (sendIfQuotaError(res, err)) return;
    console.error('[api] manual start error:', err);
    res.status(500).json({ error: 'Failed to start scheduled meeting' });
  }
});

router.get('/health', (_req, res) => res.json({ ok: true }));

export default router;