import { Router, Request, Response } from 'express';
import {
  syncCalendar,
  getUpcomingEvents,
  setAutoJoin,
} from '../services/calendarService';

const router = Router();

// Middleware — require auth on all calendar routes
router.use((req: Request, res: Response, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
});

// POST /api/calendar/sync — fetch latest events from Google Calendar
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const events = await syncCalendar(req.session.userId!);
    res.json({ synced: events.length, events });
  } catch (err) {
    console.error('[calendar] Sync error:', err);
    res.status(500).json({ error: 'Calendar sync failed. Check Google account connection.' });
  }
});

// GET /api/calendar/events — list upcoming events from DB
router.get('/events', async (req: Request, res: Response) => {
  try {
    const events = await getUpcomingEvents(req.session.userId!);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// PATCH /api/calendar/events/:id/auto-join — toggle auto-join
router.patch('/events/:id/auto-join', async (req: Request, res: Response) => {
  const { autoJoin } = req.body as { autoJoin: boolean };
  try {
    await setAutoJoin(req.session.userId!, req.params.id, Boolean(autoJoin));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update auto-join' });
  }
});

export default router;
