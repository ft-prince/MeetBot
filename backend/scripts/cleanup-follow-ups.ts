/**
 * One-off: dismiss pending follow-ups created before followUpFilter existed
 * (receipts, newsletters, self-sent alerts, drafts, calendar invites) and
 * duplicate follow-ups on one thread. Dismissed, not deleted —
 * reversible by setting status back to 'pending'.
 *
 *   npx tsx scripts/cleanup-follow-ups.ts           # dry run: counts only
 *   npx tsx scripts/cleanup-follow-ups.ts --apply   # dismiss them
 */
import 'dotenv/config';
import { db } from '../src/db/client';
import { followUpSkipReason } from '../src/services/followUpFilter';

(async () => {
  const apply = process.argv.includes('--apply');
  const { rows } = await db.query(`
    SELECT f.id, u.email AS user_email, et.subject, et.label_ids,
           e.from_address, e.to_addresses, e.cc_addresses, e.is_sent_by_user
      FROM email_follow_ups f
      JOIN email_threads et ON et.id = f.thread_id
      JOIN users u ON u.id = f.user_id
      JOIN LATERAL (SELECT * FROM emails WHERE thread_id = et.id ORDER BY sent_at DESC LIMIT 1) e ON true
     WHERE f.status = 'pending'`);

  const byReason: Record<string, number> = {};
  const toDismiss: string[] = [];
  const kept: string[] = [];
  for (const r of rows) {
    const reason = followUpSkipReason({
      userEmail: r.user_email,
      subject: r.subject ?? '',
      labelIds: r.label_ids ?? [],
      lastEmail: { fromAddress: r.from_address, toAddresses: r.to_addresses ?? [], ccAddresses: r.cc_addresses ?? [], isSentByUser: r.is_sent_by_user },
    });
    if (reason) { byReason[reason] = (byReason[reason] ?? 0) + 1; toDismiss.push(r.id); }
    else kept.push(`${r.user_email}: ${r.subject.slice(0, 70)}`);
  }
  console.log(`pending: ${rows.length}  → dismiss: ${toDismiss.length}`, byReason);
  console.log(`keep (${kept.length}):\n  ` + kept.join('\n  '));

  if (apply && toDismiss.length) {
    const res = await db.query(`UPDATE email_follow_ups SET status = 'dismissed' WHERE id = ANY($1::uuid[]) AND status = 'pending'`, [toDismiss]);
    console.log(`dismissed ${res.rowCount}`);
  }

  // Duplicates: older pending follow-ups on a thread that has a newer one.
  const dupSql = `FROM email_follow_ups f WHERE f.status = 'pending' AND EXISTS (
      SELECT 1 FROM email_follow_ups g WHERE g.thread_id = f.thread_id AND g.status = 'pending' AND g.created_at > f.created_at)`;
  const dups = await db.query(`SELECT count(*)::int AS n ${dupSql}`);
  console.log(`duplicates: ${dups.rows[0].n}`);
  if (apply && dups.rows[0].n) {
    const res = await db.query(`UPDATE email_follow_ups SET status = 'dismissed' WHERE id IN (SELECT f.id ${dupSql})`);
    console.log(`dismissed ${res.rowCount} duplicates`);
  }
  if (!apply) console.log('(dry run — nothing changed; add --apply)');
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
