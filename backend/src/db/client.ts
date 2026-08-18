import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export const db = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

db.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

export async function dbReady(): Promise<void> {
  const client = await db.connect();
  await client.query('SELECT 1');
  client.release();
}

/**
 * Guarantee the schema exists before the app starts serving traffic. If the core
 * `transcript_segments` table is missing (e.g. migrations were never run on this
 * database), apply the idempotent schema.sql automatically. Without this, EVERY
 * transcript write throws "relation does not exist" — which, because those errors
 * were previously swallowed, presented as "live transcription works but nothing
 * is ever saved".
 */
export async function ensureSchema(): Promise<void> {
  const exists = await db.query(`SELECT to_regclass('public.transcript_segments') AS t`);
  // Also re-apply when a column added in a newer release is missing, so existing
  // installations pick up idempotent ALTERs without a manual db:migrate.
  // Sentinel: users.plan (SaaS plans/quotas, 2026-08).
  const upToDate = exists.rows[0]?.t
    ? (await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'users' AND column_name = 'plan'`,
      )).rows.length > 0
    : false;
  if (upToDate) return; // schema already present and current — nothing to do

  // Resolve schema.sql relative to the backend working directory so it works in
  // both `tsx` (src) and compiled (dist) runs.
  const candidates = [
    path.join(process.cwd(), 'src', 'db', 'schema.sql'),
    path.join(__dirname, 'schema.sql'),
    path.resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql'),
  ];
  const schemaPath = candidates.find(p => fs.existsSync(p));
  if (!schemaPath) {
    console.error('[db] transcript_segments table missing AND schema.sql not found — run `npm run db:migrate` manually!');
    return;
  }
  console.warn(`[db] Core tables missing — applying schema from ${schemaPath}`);
  await db.query(fs.readFileSync(schemaPath, 'utf8'));
  console.log('[db] Schema applied successfully');
}
