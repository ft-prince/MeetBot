import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { PLANS, effectivePlan, isPlanId } from '../services/planService';

const router = Router();

// Every /api/admin route requires a signed-in user with users.is_admin = true.
// Promote the first admin by hand: UPDATE users SET is_admin = true WHERE email = '...';
router.use(async (req: Request, res: Response, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const { rows } = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (!rows[0]?.is_admin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  } catch (err) {
    console.error('[admin] auth check failed:', err);
    res.status(500).json({ error: 'Failed to verify admin access' });
  }
});

// GET /api/admin/stats — headline numbers for the admin dashboard
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(`
      SELECT
        (SELECT count(*)::int FROM users)                                          AS total_users,
        (SELECT count(*)::int FROM users WHERE plan <> 'free')                     AS paid_users,
        (SELECT count(*)::int FROM users WHERE created_at >= now() - interval '30 days') AS new_users_30d,
        (SELECT count(*)::int FROM meetings)                                       AS total_meetings,
        (SELECT count(*)::int FROM meetings WHERE started_at >= date_trunc('month', now())) AS meetings_this_month,
        (SELECT count(*)::int FROM meetings WHERE ended_at IS NULL)                AS meetings_in_progress,
        (SELECT count(DISTINCT user_id)::int FROM meetings
          WHERE started_at >= now() - interval '30 days')                          AS active_users_30d,
        (SELECT COALESCE(sum(duration_ms), 0)::bigint FROM meetings
          WHERE started_at >= date_trunc('month', now()))                          AS minutes_this_month,
        -- A meeting that ended without a summary means the AI pipeline failed for it.
        (SELECT count(*)::int FROM meetings
          WHERE ended_at IS NOT NULL AND summary IS NULL
            AND started_at >= now() - interval '30 days')                          AS failed_summaries_30d
    `);
    const r = rows[0];
    res.json({
      totalUsers: r.total_users,
      paidUsers: r.paid_users,
      newUsers30d: r.new_users_30d,
      activeUsers30d: r.active_users_30d,
      totalMeetings: r.total_meetings,
      meetingsThisMonth: r.meetings_this_month,
      meetingsInProgress: r.meetings_in_progress,
      minutesThisMonth: Math.round(Number(r.minutes_this_month) / 60000),
      failedSummaries30d: r.failed_summaries_30d,
    });
  } catch (err) {
    console.error('[admin] stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/admin/timeseries?days=30 — daily signups and meetings for the charts.
// generate_series supplies the zero rows, so a quiet day is a gap in the chart
// rather than a missing point the frontend has to guess at.
router.get('/timeseries', async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 7), 90);
  try {
    const [series, plans] = await Promise.all([
      db.query(
        `SELECT d::date AS day,
                (SELECT count(*)::int FROM users u    WHERE u.created_at::date  = d::date) AS signups,
                (SELECT count(*)::int FROM meetings m WHERE m.started_at::date  = d::date) AS meetings,
                (SELECT count(DISTINCT m.user_id)::int FROM meetings m
                  WHERE m.started_at::date = d::date)                                      AS active_users
           FROM generate_series(current_date - ($1::int - 1), current_date, interval '1 day') d
          ORDER BY day`,
        [days],
      ),
      db.query(`SELECT plan, count(*)::int AS n FROM users GROUP BY plan`),
    ]);
    res.json({
      days,
      series: series.rows.map(r => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        signups: r.signups,
        meetings: r.meetings,
        activeUsers: r.active_users,
      })),
      planCounts: Object.fromEntries(plans.rows.map(r => [r.plan, r.n])),
    });
  } catch (err) {
    console.error('[admin] timeseries error:', err);
    res.status(500).json({ error: 'Failed to load usage history' });
  }
});

// GET /api/admin/users/:id — one user: plan, usage, and what they actually do
router.get('/users/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const [userRes, countsRes, meetingsRes] = await Promise.all([
      db.query(
        `SELECT id, email, name, picture, plan, plan_until, is_admin, created_at, auto_join_minutes
           FROM users WHERE id = $1`, [id]),
      db.query(
        `SELECT
           (SELECT count(*)::int FROM meetings WHERE user_id = $1)                    AS meetings_total,
           (SELECT count(*)::int FROM meetings
             WHERE user_id = $1 AND started_at >= date_trunc('month', now()))         AS meetings_this_month,
           (SELECT COALESCE(sum(duration_ms), 0)::bigint FROM meetings WHERE user_id = $1) AS total_duration_ms,
           (SELECT max(started_at) FROM meetings WHERE user_id = $1)                  AS last_meeting_at,
           (SELECT count(*)::int FROM email_threads WHERE user_id = $1)               AS email_threads,
           (SELECT count(*)::int FROM email_action_items WHERE user_id = $1)          AS email_action_items,
           (SELECT count(*)::int FROM scheduled_meetings
             WHERE user_id = $1 AND status = 'scheduled')                             AS scheduled_upcoming`,
        [id]),
      db.query(
        `SELECT id, title, meeting_code, started_at, ended_at, duration_ms,
                (summary IS NOT NULL) AS has_summary
           FROM meetings WHERE user_id = $1 ORDER BY started_at DESC LIMIT 20`, [id]),
    ]);

    const u = userRes.rows[0];
    if (!u) { res.status(404).json({ error: 'User not found' }); return; }
    const c = countsRes.rows[0];
    const plan = effectivePlan(u.plan, u.plan_until);

    res.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        picture: u.picture,
        plan: u.plan,
        planUntil: u.plan_until,
        isAdmin: u.is_admin,
        createdAt: u.created_at,
        autoJoinMinutes: u.auto_join_minutes,
        effectivePlan: plan.id,
        meetingsLimit: plan.meetingsPerMonth,
        emailSyncDays: plan.emailSyncDays,
      },
      counts: {
        meetingsTotal: c.meetings_total,
        meetingsThisMonth: c.meetings_this_month,
        totalDurationMs: Number(c.total_duration_ms),
        lastMeetingAt: c.last_meeting_at,
        emailThreads: c.email_threads,
        emailActionItems: c.email_action_items,
        scheduledUpcoming: c.scheduled_upcoming,
      },
      recentMeetings: meetingsRes.rows.map(m => ({
        id: m.id,
        title: m.title,
        meetingCode: m.meeting_code,
        startedAt: m.started_at,
        endedAt: m.ended_at,
        durationMs: m.duration_ms,
        hasSummary: m.has_summary,
      })),
    });
  } catch (err) {
    console.error('[admin] user detail error:', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// GET /api/admin/users?q=&limit= — user list with this month's meeting usage
router.get('/users', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.picture, u.plan, u.plan_until, u.is_admin, u.created_at,
              (SELECT count(*)::int FROM meetings m
                WHERE m.user_id = u.id AND m.started_at >= date_trunc('month', now())) AS meetings_this_month,
              (SELECT count(*)::int FROM meetings m WHERE m.user_id = u.id) AS meetings_total
         FROM users u
        WHERE $1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%'
        ORDER BY u.created_at DESC
        LIMIT $2`,
      [q, limit],
    );
    res.json({
      users: rows.map((r): Record<string, unknown> => {
        const plan: unknown = r.plan;
        return {
          id: r.id,
          email: r.email,
          name: r.name,
          picture: r.picture,
          plan,
          planUntil: r.plan_until,
          isAdmin: r.is_admin,
          createdAt: r.created_at,
          meetingsThisMonth: r.meetings_this_month,
          meetingsTotal: r.meetings_total,
          meetingsLimit: (isPlanId(plan) ? PLANS[plan] : PLANS.free).meetingsPerMonth,
        };
      }),
    });
  } catch (err) {
    console.error('[admin] users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// PATCH /api/admin/users/:id/plan — set a user's plan (manual until billing exists)
router.patch('/users/:id/plan', async (req: Request, res: Response) => {
  const { plan, planUntil } = req.body as { plan?: unknown; planUntil?: unknown };
  if (!isPlanId(plan)) {
    res.status(400).json({ error: `plan must be one of: ${Object.keys(PLANS).join(', ')}` });
    return;
  }
  let until: Date | null = null;
  if (planUntil != null && planUntil !== '') {
    const parsed = new Date(String(planUntil));
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'planUntil must be a valid date' });
      return;
    }
    until = parsed;
  }
  try {
    const { rowCount } = await db.query(
      'UPDATE users SET plan = $1, plan_until = $2, updated_at = now() WHERE id = $3',
      [plan, until, req.params.id],
    );
    if (!rowCount) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ ok: true, plan, planUntil: until });
  } catch (err) {
    console.error('[admin] set plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

export default router;
