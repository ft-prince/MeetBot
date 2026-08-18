import { Router, Request, Response } from 'express';
import { db } from '../db/client';

const router = Router();

router.use((req: Request, res: Response, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
});

/**
 * GET /api/account/export — everything we hold on this user, as one JSON file.
 * Required by GDPR/DPDP and by Google's Limited Use rules for the Gmail scopes.
 * Deliberately a single synchronous response: a mailbox-sized export would need a
 * job queue, and nobody has one big enough to need it yet.
 */
router.get('/export', async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    const [user, meetings, transcripts, threads, emails, actionItems, followUps] = await Promise.all([
      db.query(
        `SELECT id, email, name, picture, plan, plan_until, auto_join_minutes, created_at
           FROM users WHERE id = $1`, [userId]),
      db.query(
        `SELECT id, meeting_code, title, started_at, ended_at, duration_ms, summary,
                key_insights, metadata, language
           FROM meetings WHERE user_id = $1 ORDER BY started_at DESC`, [userId]),
      db.query(
        `SELECT s.meeting_id, s.text, s.start_ms, s.end_ms,
                COALESCE(sp.display_name, s.speaker_name, s.speaker_label) AS speaker
           FROM transcript_segments s
           JOIN meetings m ON m.id = s.meeting_id
           LEFT JOIN speakers sp ON sp.id = s.speaker_id
          WHERE m.user_id = $1
          ORDER BY s.meeting_id, s.start_ms`, [userId]),
      db.query(
        `SELECT id, gmail_thread_id, subject, participants, last_message_at, project_tag
           FROM email_threads WHERE user_id = $1 ORDER BY last_message_at DESC`, [userId]),
      db.query(
        `SELECT thread_id, gmail_message_id, from_address, from_name, subject, sent_at, is_sent_by_user
           FROM emails WHERE user_id = $1 ORDER BY sent_at DESC`, [userId]),
      db.query(`SELECT * FROM email_action_items WHERE user_id = $1`, [userId]),
      db.query(`SELECT * FROM email_follow_ups WHERE user_id = $1`, [userId]),
    ]);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="meetmaster-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      user: user.rows[0] ?? null,
      meetings: meetings.rows,
      transcriptSegments: transcripts.rows,
      emailThreads: threads.rows,
      emails: emails.rows,
      emailActionItems: actionItems.rows,
      emailFollowUps: followUps.rows,
    });
  } catch (err) {
    console.error('[account] export error:', err);
    res.status(500).json({ error: 'Failed to export your data' });
  }
});

/**
 * DELETE /api/account — irreversible. Everything else cascades from `users`, but
 * meetings are ON DELETE SET NULL (so a shared meeting survives its owner), which
 * means account deletion has to remove them explicitly or the transcripts would
 * outlive the account. Both statements run in one transaction.
 */
router.delete('/', async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Cascades to transcript_segments, speakers, dom_speaker_events.
    await client.query('DELETE FROM meetings WHERE user_id = $1', [userId]);
    // Cascades to calendar_events, scheduled_meetings, email_* tables.
    const { rowCount } = await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    if (!rowCount) { res.status(404).json({ error: 'Account not found' }); return; }
    console.log(`[account] deleted account ${userId}`);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[account] delete error:', err);
    res.status(500).json({ error: 'Failed to delete your account' });
  } finally {
    client.release();
  }
});

export default router;
