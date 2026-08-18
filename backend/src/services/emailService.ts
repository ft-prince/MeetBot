import { google, gmail_v1 } from 'googleapis';
import { db } from '../db/client';
import { getAuthedClient } from './googleAuth';
import { capSyncDays, getPlan } from './planService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParsedEmail {
  gmailMessageId: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  sentAt: Date;
  hasAttachments: boolean;
}

interface SyncResult {
  threadsProcessed: number;
  messagesProcessed: number;
  newThreads: number;
  updatedThreads: number;
}

export interface EmailThread {
  id: string;
  gmailThreadId: string;
  subject: string;
  snippet: string | null;
  participants: { name?: string; email: string }[];
  messageCount: number;
  lastMessageAt: string;
  firstMessageAt: string;
  isUnread: boolean;
  projectTag: string | null;
}

export interface Email {
  id: string;
  threadId: string;
  gmailMessageId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  bodyText: string | null;
  sentAt: string;
  isSentByUser: boolean;
  hasAttachments: boolean;
}

// ─── Sync window ────────────────────────────────────────────────────────────

/**
 * Selectable lookback windows, in days. Anything outside this set is clamped by
 * `normalizeSyncDays` so a hand-crafted request can't ask Gmail for five years
 * of mail and then feed all of it to the LLM.
 */
export const SYNC_WINDOW_OPTIONS = [10, 15, 30] as const;
export const DEFAULT_SYNC_DAYS = 30;

export function normalizeSyncDays(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_DAYS;
  // Snap to the nearest allowed option rather than rejecting — callers get a
  // predictable window instead of an error they have to handle.
  return SYNC_WINDOW_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - n) < Math.abs(best - n) ? opt : best,
  DEFAULT_SYNC_DAYS as number);
}

/** The window this user last synced with, falling back to the default. */
export async function getSyncDays(userId: string): Promise<number> {
  const res = await db.query('SELECT sync_days FROM email_sync_state WHERE user_id = $1', [userId]);
  const stored = res.rows[0]?.sync_days;
  return stored == null ? DEFAULT_SYNC_DAYS : normalizeSyncDays(stored);
}

// ─── Gmail helpers ──────────────────────────────────────────────────────────

function getGmail(auth: InstanceType<typeof google.auth.OAuth2>) {
  return google.gmail({ version: 'v1', auth });
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
  return { name: '', email: raw.trim() };
}

function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map(a => a.trim()).filter(Boolean);
}

function extractBodyFromParts(parts: gmail_v1.Schema$MessagePart[] | undefined): { text: string; html: string } {
  let text = '';
  let html = '';
  if (!parts) return { text, html };

  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text += decodeBase64Url(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html += decodeBase64Url(part.body.data);
    } else if (part.parts) {
      const nested = extractBodyFromParts(part.parts);
      if (!text && nested.text) text = nested.text;
      if (!html && nested.html) html = nested.html;
    }
  }
  return { text, html };
}

function parseGmailMessage(msg: gmail_v1.Schema$Message): ParsedEmail {
  const headers = msg.payload?.headers;
  const from = extractHeader(headers, 'From');
  const parsed = parseAddress(from);
  const { text, html } = msg.payload?.parts
    ? extractBodyFromParts(msg.payload.parts)
    : {
        text: msg.payload?.body?.data ? decodeBase64Url(msg.payload.body.data) : '',
        html: '',
      };

  const hasAttachments = (msg.payload?.parts ?? []).some(
    p => p.filename && p.filename.length > 0 && p.body?.attachmentId,
  );

  return {
    gmailMessageId: msg.id!,
    threadId: msg.threadId!,
    from: parsed.email,
    fromName: parsed.name,
    to: parseAddressList(extractHeader(headers, 'To')),
    cc: parseAddressList(extractHeader(headers, 'Cc')),
    subject: extractHeader(headers, 'Subject'),
    bodyText: text.slice(0, 50_000),
    bodyHtml: html.slice(0, 100_000),
    sentAt: new Date(parseInt(msg.internalDate!, 10)),
    hasAttachments,
  };
}

// ─── Sync ───────────────────────────────────────────────────────────────────

export async function syncEmails(userId: string, opts: { days?: number } = {}): Promise<SyncResult> {
  const auth = await getAuthedClient(userId);
  const gmail = getGmail(auth);

  // An explicit `days` wins and becomes the user's new stored preference;
  // otherwise reuse whatever they synced with last time.
  // The plan caps the window, so a stored preference from a lapsed paid plan
  // can't keep pulling a wider mailbox than the current plan allows.
  const requested = opts.days == null ? await getSyncDays(userId) : normalizeSyncDays(opts.days);
  const syncDays = capSyncDays(requested, await getPlan(userId));

  const userRow = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
  const userEmail = userRow.rows[0]?.email ?? '';

  await db.query(
    `INSERT INTO email_sync_state (user_id, sync_status, last_sync_at, sync_days)
     VALUES ($1, 'syncing', now(), $2)
     ON CONFLICT (user_id) DO UPDATE SET sync_status = 'syncing', sync_days = EXCLUDED.sync_days`,
    [userId, syncDays],
  );

  const result: SyncResult = { threadsProcessed: 0, messagesProcessed: 0, newThreads: 0, updatedThreads: 0 };

  try {
    const windowStart = Math.floor((Date.now() - syncDays * 24 * 60 * 60 * 1000) / 1000);
    const query = `after:${windowStart}`;
    console.log(`[email-sync] user ${userId} — fetching last ${syncDays} day(s)`);

    let pageToken: string | undefined;
    const allThreadIds: string[] = [];

    do {
      const listRes = await gmail.users.threads.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken,
      });

      for (const t of listRes.data.threads ?? []) {
        if (t.id) allThreadIds.push(t.id);
      }
      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken);

    for (const threadId of allThreadIds) {
      try {
        const threadRes = await gmail.users.threads.get({
          userId: 'me',
          id: threadId,
          format: 'full',
        });

        const messages = threadRes.data.messages ?? [];
        if (messages.length === 0) continue;

        const parsedMessages = messages.map(parseGmailMessage);
        const firstMsg = parsedMessages[0];
        const lastMsg = parsedMessages[parsedMessages.length - 1];

        const participantMap = new Map<string, string>();
        for (const m of parsedMessages) {
          if (!participantMap.has(m.from)) {
            participantMap.set(m.from, m.fromName);
          }
        }
        const participants = [...participantMap.entries()].map(([email, name]) => ({ email, name }));

        const isUnread = (threadRes.data.messages?.[messages.length - 1]?.labelIds ?? []).includes('UNREAD');
        const labelIds = [...new Set(messages.flatMap(m => m.labelIds ?? []))];

        const threadUpsert = await db.query(
          `INSERT INTO email_threads (user_id, gmail_thread_id, subject, snippet, participants, label_ids, message_count, last_message_at, first_message_at, is_unread, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (user_id, gmail_thread_id) DO UPDATE SET
             subject = EXCLUDED.subject,
             snippet = EXCLUDED.snippet,
             participants = EXCLUDED.participants,
             label_ids = EXCLUDED.label_ids,
             message_count = EXCLUDED.message_count,
             last_message_at = EXCLUDED.last_message_at,
             is_unread = EXCLUDED.is_unread,
             synced_at = now()
           RETURNING id, (xmax = 0) AS is_new`,
          [
            userId,
            threadId,
            firstMsg.subject,
            threadRes.data.snippet ?? null,
            JSON.stringify(participants),
            JSON.stringify(labelIds),
            parsedMessages.length,
            lastMsg.sentAt,
            firstMsg.sentAt,
            isUnread,
          ],
        );

        const dbThreadId = threadUpsert.rows[0].id;
        const isNew = threadUpsert.rows[0].is_new;
        if (isNew) result.newThreads++;
        else result.updatedThreads++;

        for (const pm of parsedMessages) {
          const isSent = pm.from.toLowerCase() === userEmail.toLowerCase();
          await db.query(
            `INSERT INTO emails (thread_id, user_id, gmail_message_id, from_address, from_name, to_addresses, cc_addresses, subject, body_text, body_html, sent_at, is_sent_by_user, has_attachments, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
             ON CONFLICT (user_id, gmail_message_id) DO NOTHING`,
            [
              dbThreadId,
              userId,
              pm.gmailMessageId,
              pm.from,
              pm.fromName || null,
              JSON.stringify(pm.to),
              JSON.stringify(pm.cc),
              pm.subject,
              pm.bodyText,
              pm.bodyHtml,
              pm.sentAt,
              isSent,
              pm.hasAttachments,
            ],
          );
          result.messagesProcessed++;
        }

        result.threadsProcessed++;
      } catch (err) {
        console.warn(`[email-sync] Failed to process thread ${threadId}:`, (err as Error).message);
      }
    }

    await db.query(
      `UPDATE email_sync_state SET sync_status = 'idle', last_sync_at = now(), total_synced = $2, error_message = NULL WHERE user_id = $1`,
      [userId, result.threadsProcessed],
    );
  } catch (err) {
    await db.query(
      `UPDATE email_sync_state SET sync_status = 'error', error_message = $2 WHERE user_id = $1`,
      [userId, (err as Error).message],
    );
    throw err;
  }

  return result;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function listEmailThreads(
  userId: string,
  opts: { limit?: number; offset?: number; search?: string; projectTag?: string; unreadOnly?: boolean } = {},
): Promise<{ threads: EmailThread[]; total: number }> {
  const { limit = 50, offset = 0, search, projectTag, unreadOnly } = opts;
  const conditions = ['et.user_id = $1'];
  const params: unknown[] = [userId];
  let idx = 2;

  if (search) {
    conditions.push(`to_tsvector('english', et.subject) @@ plainto_tsquery('english', $${idx})`);
    params.push(search);
    idx++;
  }
  if (projectTag) {
    conditions.push(`et.project_tag = $${idx}`);
    params.push(projectTag);
    idx++;
  }
  if (unreadOnly) {
    conditions.push('et.is_unread = true');
  }

  const where = conditions.join(' AND ');

  const countRes = await db.query(`SELECT COUNT(*) FROM email_threads et WHERE ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(limit, offset);
  const dataRes = await db.query(
    `SELECT et.* FROM email_threads et WHERE ${where} ORDER BY et.last_message_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    params,
  );

  const threads: EmailThread[] = dataRes.rows.map(rowToThread);
  return { threads, total };
}

export async function getEmailThread(threadId: string, userId: string): Promise<EmailThread | null> {
  const res = await db.query('SELECT * FROM email_threads WHERE id = $1 AND user_id = $2', [threadId, userId]);
  if (!res.rows[0]) return null;
  return rowToThread(res.rows[0]);
}

export async function getThreadEmails(threadId: string, userId: string): Promise<Email[]> {
  const res = await db.query(
    'SELECT * FROM emails WHERE thread_id = $1 AND user_id = $2 ORDER BY sent_at ASC',
    [threadId, userId],
  );
  return res.rows.map(rowToEmail);
}

export async function getSyncState(userId: string) {
  const res = await db.query('SELECT * FROM email_sync_state WHERE user_id = $1', [userId]);
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return {
    lastSyncAt: r.last_sync_at,
    totalSynced: r.total_synced,
    syncStatus: r.sync_status,
    errorMessage: r.error_message,
    syncDays: r.sync_days ?? DEFAULT_SYNC_DAYS,
    syncDayOptions: SYNC_WINDOW_OPTIONS,
  };
}

export async function searchEmails(
  userId: string,
  query: string,
  limit = 30,
): Promise<{ threadId: string; subject: string; snippet: string; matchedText: string }[]> {
  const res = await db.query(
    `SELECT DISTINCT ON (e.thread_id)
       e.thread_id, et.subject, et.snippet,
       ts_headline('english', e.body_text, plainto_tsquery('english', $2), 'MaxWords=30, MinWords=10') AS matched_text
     FROM emails e
     JOIN email_threads et ON et.id = e.thread_id
     WHERE e.user_id = $1
       AND to_tsvector('english', e.body_text) @@ plainto_tsquery('english', $2)
     ORDER BY e.thread_id, e.sent_at DESC
     LIMIT $3`,
    [userId, query, limit],
  );
  return res.rows.map(r => ({
    threadId: r.thread_id,
    subject: r.subject,
    snippet: r.snippet,
    matchedText: r.matched_text,
  }));
}

// ─── Row mappers ────────────────────────────────────────────────────────────

function rowToThread(r: Record<string, unknown>): EmailThread {
  return {
    id: r.id as string,
    gmailThreadId: r.gmail_thread_id as string,
    subject: r.subject as string,
    snippet: r.snippet as string | null,
    participants: (r.participants ?? []) as { name?: string; email: string }[],
    messageCount: r.message_count as number,
    lastMessageAt: (r.last_message_at as Date).toISOString(),
    firstMessageAt: (r.first_message_at as Date).toISOString(),
    isUnread: r.is_unread as boolean,
    projectTag: r.project_tag as string | null,
  };
}

function rowToEmail(r: Record<string, unknown>): Email {
  return {
    id: r.id as string,
    threadId: r.thread_id as string,
    gmailMessageId: r.gmail_message_id as string,
    fromAddress: r.from_address as string,
    fromName: r.from_name as string | null,
    toAddresses: (r.to_addresses ?? []) as string[],
    ccAddresses: (r.cc_addresses ?? []) as string[],
    subject: r.subject as string | null,
    bodyText: r.body_text as string | null,
    sentAt: (r.sent_at as Date).toISOString(),
    isSentByUser: r.is_sent_by_user as boolean,
    hasAttachments: r.has_attachments as boolean,
  };
}
