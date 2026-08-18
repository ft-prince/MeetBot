import { Router, Request, Response } from 'express';
import {
  syncEmails,
  listEmailThreads,
  getEmailThread,
  getThreadEmails,
  getSyncState,
  getSyncDays,
  normalizeSyncDays,
  searchEmails,
} from '../services/emailService';
import {
  analyzeThread,
  analyzeUnanalyzedThreads,
  detectFollowUps,
  getFollowUpDashboard,
  getActionItemDashboard,
  updateActionItemStatus,
  updateFollowUpStatus,
  generateDailyBrief,
  getStoredAnalysis,
  getAnalysisProgress,
  onAnalysisProgress,
} from '../services/emailAnalysisService';

const router = Router();

// ── Sync ─────────────────────────────────────────────────────────────────────

router.post('/sync', async (req: Request, res: Response) => {
  try {
    // `days` is optional; when present it becomes the user's stored window.
    // Values are snapped to SYNC_WINDOW_OPTIONS, so a bad value narrows the
    // sync rather than failing the request.
    const raw = (req.body as { days?: unknown })?.days ?? req.query.days;
    const days = raw == null ? undefined : normalizeSyncDays(raw);

    const result = await syncEmails(req.session.userId!, { days });
    res.json({ success: true, syncDays: days ?? await getSyncDays(req.session.userId!), ...result });
  } catch (err) {
    console.error('[email-api] sync error:', err);
    res.status(500).json({ error: 'Failed to sync emails' });
  }
});

router.get('/sync/status', async (req: Request, res: Response) => {
  try {
    const state = await getSyncState(req.session.userId!);
    res.json({ syncState: state });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// ── Threads ──────────────────────────────────────────────────────────────────

router.get('/threads', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || undefined;
    const projectTag = (req.query.project as string) || undefined;
    const unreadOnly = req.query.unread === 'true';

    const { threads, total } = await listEmailThreads(req.session.userId!, {
      limit,
      offset,
      search,
      projectTag,
      unreadOnly,
    });
    res.json({ threads, total, limit, offset });
  } catch (err) {
    console.error('[email-api] list threads error:', err);
    res.status(500).json({ error: 'Failed to list email threads' });
  }
});

router.get('/threads/:id', async (req: Request, res: Response) => {
  try {
    const thread = await getEmailThread(req.params.id, req.session.userId!);
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

    const emails = await getThreadEmails(req.params.id, req.session.userId!);
    const analysis = await getStoredAnalysis(req.params.id);

    res.json({ thread, emails, analysis });
  } catch (err) {
    console.error('[email-api] get thread error:', err);
    res.status(500).json({ error: 'Failed to get thread' });
  }
});

// ── Analysis ─────────────────────────────────────────────────────────────────

router.post('/threads/:id/analyze', async (req: Request, res: Response) => {
  try {
    const analysis = await analyzeThread(req.params.id, req.session.userId!);
    if (!analysis) { res.status(404).json({ error: 'Thread not found or AI unavailable' }); return; }
    res.json({ analysis });
  } catch (err) {
    console.error('[email-api] analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze thread' });
  }
});

router.post('/analyze-batch', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    // `all=true` is the explicit "re-analyze my whole mailbox" escape hatch —
    // it has to be asked for, it is never the default.
    const allTime = req.query.all === 'true';
    const withinDays = req.query.days ? normalizeSyncDays(req.query.days) : undefined;

    const analyzed = await analyzeUnanalyzedThreads(req.session.userId!, { limit, withinDays, allTime });
    res.json({ analyzed });
  } catch (err) {
    console.error('[email-api] batch analyze error:', err);
    res.status(500).json({ error: 'Failed to batch analyze' });
  }
});

router.get('/analyze-progress', (req: Request, res: Response) => {
  const progress = getAnalysisProgress(req.session.userId!);
  res.json(progress);
});

router.get('/analyze-progress/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const userId = req.session.userId!;

  const current = getAnalysisProgress(userId);
  res.write(`data: ${JSON.stringify(current)}\n\n`);

  const unsub = onAnalysisProgress(userId, (progress) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  });

  req.on('close', () => {
    unsub();
  });
});

// ── Follow-ups ───────────────────────────────────────────────────────────────

router.post('/detect-follow-ups', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 3;
    const created = await detectFollowUps(req.session.userId!, days);
    res.json({ created });
  } catch (err) {
    console.error('[email-api] detect follow-ups error:', err);
    res.status(500).json({ error: 'Failed to detect follow-ups' });
  }
});

router.get('/follow-ups', async (req: Request, res: Response) => {
  try {
    const dashboard = await getFollowUpDashboard(req.session.userId!);
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get follow-ups' });
  }
});

router.patch('/follow-ups/:id', async (req: Request, res: Response) => {
  const { status } = req.body as { status?: string };
  if (!status || !['pending', 'completed', 'snoozed', 'dismissed'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  try {
    const ok = await updateFollowUpStatus(req.params.id, req.session.userId!, status as 'pending' | 'completed' | 'snoozed' | 'dismissed');
    if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update follow-up' });
  }
});

// ── Action Items ─────────────────────────────────────────────────────────────

router.get('/action-items', async (req: Request, res: Response) => {
  try {
    const dashboard = await getActionItemDashboard(req.session.userId!);
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get action items' });
  }
});

router.patch('/action-items/:id', async (req: Request, res: Response) => {
  const { status } = req.body as { status?: string };
  if (!status || !['open', 'completed', 'dismissed'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  try {
    const ok = await updateActionItemStatus(req.params.id, req.session.userId!, status as 'open' | 'completed' | 'dismissed');
    if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update action item' });
  }
});

// ── Search ───────────────────────────────────────────────────────────────────

router.get('/search', async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q || q.trim().length < 2) {
    res.status(400).json({ error: 'Query too short' });
    return;
  }
  try {
    const results = await searchEmails(req.session.userId!, q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search emails' });
  }
});

// ── Daily Brief ──────────────────────────────────────────────────────────────

router.get('/daily-brief', async (req: Request, res: Response) => {
  try {
    const brief = await generateDailyBrief(req.session.userId!);
    res.json(brief);
  } catch (err) {
    console.error('[email-api] daily brief error:', err);
    res.status(500).json({ error: 'Failed to generate daily brief' });
  }
});

export default router;
