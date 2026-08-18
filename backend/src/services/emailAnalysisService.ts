import Groq from 'groq-sdk';
import { config } from '../config';
import { db } from '../db/client';
import { getSyncDays, getThreadEmails } from './emailService';
import type { Email } from './emailService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ThreadAnalysis {
  summary: string;
  status: string;
  keyPoints: string[];
  decisions: string[];
  risks: string[];
  actionItems: ActionItemRaw[];
  followUpNeeded: boolean;
  followUpReason: string | null;
  suggestedReply: string | null;
  nextAction: string | null;
}

interface ActionItemRaw {
  task: string;
  owner: string | null;
  dueHint: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface DailyBrief {
  date: string;
  followUps: { threadId: string; subject: string; reason: string; daysWaiting: number }[];
  pendingActions: { threadId: string; subject: string; task: string; priority: string }[];
  newThreads: number;
  unrepliedCount: number;
  briefText: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MODEL = 'llama-3.1-8b-instant';
const MAX_EMAIL_CHARS = 10_000;
const DEFAULT_FOLLOW_UP_DAYS = 3;

// ─── Groq client ────────────────────────────────────────────────────────────

let groqClient: Groq | null = null;
function getGroq(): Groq {
  if (!groqClient) groqClient = new Groq({ apiKey: config.groq.apiKey });
  return groqClient;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function tryParseJSON<T>(raw: string): T | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (cleaned.includes('```')) {
    const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) cleaned = m[1].trim();
  }
  const firstBrace = Math.min(
    ...['{', '['].map(c => {
      const i = cleaned.indexOf(c);
      return i === -1 ? Infinity : i;
    }),
  );
  if (firstBrace !== Infinity && firstBrace > 0) cleaned = cleaned.slice(firstBrace);
  try { return JSON.parse(cleaned) as T; } catch { return null; }
}

function parseRetryHint(msg: string): number | null {
  const ms = msg.match(/try again in (\d+(?:\.\d+)?)\s*ms/i);
  if (ms) return Math.ceil(Number(ms[1]));
  const s = msg.match(/try again in (\d+(?:\.\d+)?)\s*s\b/i);
  if (s) return Math.ceil(Number(s[1]) * 1000);
  return null;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      const message = (err as Error).message ?? '';
      const hint = parseRetryHint(message);
      const base = hint ?? 800 * 2 ** i;
      const jitter = Math.floor(Math.random() * 200);
      const delay = base + jitter;
      console.warn(`[email-ai] ${label} attempt ${i + 1}/${attempts} failed. Retrying in ${delay}ms…`);
      if (i < attempts - 1) await sleep(delay);
    }
  }
  throw lastErr;
}

async function groqJSON<T>(
  label: string,
  prompt: string,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<T> {
  return withRetry(label, async () => {
    const response = await getGroq().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2500,
      response_format: { type: 'json_object' },
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    const parsed = tryParseJSON<T>(raw);
    if (!parsed) throw new Error(`[${label}] LLM returned unparseable JSON`);
    return parsed;
  });
}

// ─── Thread formatting ──────────────────────────────────────────────────────

function formatThreadForLLM(emails: Email[]): string {
  return emails.map(e => {
    const direction = e.isSentByUser ? '[SENT]' : '[RECEIVED]';
    const date = new Date(e.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const body = (e.bodyText ?? '').slice(0, 2000);
    return `${direction} ${date} — From: ${e.fromName || e.fromAddress}\nSubject: ${e.subject}\n${body}`;
  }).join('\n\n---\n\n').slice(0, MAX_EMAIL_CHARS);
}

// ─── Analyze a single thread ────────────────────────────────────────────────

export async function analyzeThread(threadId: string, userId: string): Promise<ThreadAnalysis | null> {
  if (!config.groq.apiKey) return null;

  const emails = await getThreadEmails(threadId, userId);
  if (emails.length === 0) return null;

  const formatted = formatThreadForLLM(emails);
  const lastEmail = emails[emails.length - 1];
  const daysSinceLastReply = Math.floor((Date.now() - new Date(lastEmail.sentAt).getTime()) / (1000 * 60 * 60 * 24));

  const analysis = await groqJSON<{
    summary?: string;
    status?: string;
    key_points?: string[];
    decisions?: string[];
    risks?: string[];
    action_items?: ActionItemRaw[];
    follow_up_needed?: boolean;
    follow_up_reason?: string;
    suggested_reply?: string;
    next_action?: string;
  }>(
    'email-thread-analysis',
    `You are an email intelligence assistant. Analyze this email thread and provide structured insights.

Email thread (messages marked [SENT] are from the user, [RECEIVED] are from others):

${formatted}

The last message was ${daysSinceLastReply} day(s) ago. The last message was ${lastEmail.isSentByUser ? 'sent by the user' : 'received from someone else'}.

Return ONLY valid JSON:
{
  "summary": "2-3 sentence summary of the entire conversation thread",
  "status": "current status: e.g. 'Awaiting client response', 'Action required', 'Resolved', 'In discussion'",
  "key_points": ["important discussion points, requirements shared, key facts"],
  "decisions": ["decisions that were made in the conversation"],
  "risks": ["concerns, blockers, or risks mentioned"],
  "action_items": [{"task": "specific task", "owner": "person name or null", "dueHint": "deadline or null", "priority": "low|medium|high|critical"}],
  "follow_up_needed": true/false,
  "follow_up_reason": "why follow-up is needed, or null",
  "suggested_reply": "suggested follow-up message text, or null if not needed",
  "next_action": "what should happen next in this conversation"
}

Be precise. Do not invent information not present in the emails.`,
    { maxTokens: 2500 },
  );

  const result: ThreadAnalysis = {
    summary: analysis.summary ?? '',
    status: analysis.status ?? 'Unknown',
    keyPoints: (analysis.key_points ?? []).filter(x => typeof x === 'string'),
    decisions: (analysis.decisions ?? []).filter(x => typeof x === 'string'),
    risks: (analysis.risks ?? []).filter(x => typeof x === 'string'),
    actionItems: (analysis.action_items ?? []).filter(a => a?.task),
    followUpNeeded: analysis.follow_up_needed ?? false,
    followUpReason: analysis.follow_up_reason ?? null,
    suggestedReply: analysis.suggested_reply ?? null,
    nextAction: analysis.next_action ?? null,
  };

  await persistAnalysis(threadId, userId, result);
  return result;
}

// ─── Persist analysis to DB ─────────────────────────────────────────────────

async function persistAnalysis(threadId: string, userId: string, analysis: ThreadAnalysis): Promise<void> {
  await db.query(
    `INSERT INTO email_analysis (thread_id, summary, status, key_points, decisions, risks, follow_up_needed, follow_up_reason, suggested_reply, next_action, analyzed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (thread_id) DO UPDATE SET
       summary = EXCLUDED.summary,
       status = EXCLUDED.status,
       key_points = EXCLUDED.key_points,
       decisions = EXCLUDED.decisions,
       risks = EXCLUDED.risks,
       follow_up_needed = EXCLUDED.follow_up_needed,
       follow_up_reason = EXCLUDED.follow_up_reason,
       suggested_reply = EXCLUDED.suggested_reply,
       next_action = EXCLUDED.next_action,
       analyzed_at = now()`,
    [
      threadId,
      analysis.summary,
      analysis.status,
      JSON.stringify(analysis.keyPoints),
      JSON.stringify(analysis.decisions),
      JSON.stringify(analysis.risks),
      analysis.followUpNeeded,
      analysis.followUpReason,
      analysis.suggestedReply,
      analysis.nextAction,
    ],
  );

  await db.query('DELETE FROM email_action_items WHERE thread_id = $1 AND source = $2', [threadId, 'ai']);

  for (const item of analysis.actionItems) {
    await db.query(
      `INSERT INTO email_action_items (thread_id, user_id, task, owner, due_hint, priority, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'ai')`,
      [threadId, userId, item.task, item.owner, item.dueHint, item.priority || 'medium'],
    );
  }

  if (analysis.followUpNeeded) {
    await db.query(
      `INSERT INTO email_follow_ups (thread_id, user_id, reason, suggested_message, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT DO NOTHING`,
      [threadId, userId, analysis.followUpReason ?? 'Follow-up recommended', analysis.suggestedReply],
    );
  }
}

// ─── Analysis progress tracking ─────────────────────────────────────────────

export interface AnalysisProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  total: number;
  processed: number;
  remaining: number;
  percentage: number;
  currentThread: string | null;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
}

const progressByUser = new Map<string, AnalysisProgress>();

function defaultProgress(): AnalysisProgress {
  return { status: 'idle', total: 0, processed: 0, remaining: 0, percentage: 0, currentThread: null, errors: 0, startedAt: null, completedAt: null };
}

export function getAnalysisProgress(userId: string): AnalysisProgress {
  return progressByUser.get(userId) ?? defaultProgress();
}

type ProgressListener = (progress: AnalysisProgress) => void;
const progressListeners = new Map<string, Set<ProgressListener>>();

export function onAnalysisProgress(userId: string, listener: ProgressListener): () => void {
  if (!progressListeners.has(userId)) progressListeners.set(userId, new Set());
  progressListeners.get(userId)!.add(listener);
  return () => { progressListeners.get(userId)?.delete(listener); };
}

function emitProgress(userId: string, progress: AnalysisProgress): void {
  progressByUser.set(userId, progress);
  const listeners = progressListeners.get(userId);
  if (listeners) {
    for (const fn of listeners) fn(progress);
  }
}

// ─── Batch analyze (after sync) ─────────────────────────────────────────────

export interface BatchAnalysisOptions {
  limit?: number;
  /** Only analyze threads active within this many days. Defaults to the user's sync window. */
  withinDays?: number;
  /** Escape hatch for an explicit user-requested re-analysis — ignores the window. */
  allTime?: boolean;
}

/**
 * Analyze recently-active threads that have no analysis yet.
 *
 * The window matters: without it every synced thread eventually gets sent to the
 * LLM, because each scheduled run picks up the next `limit` unanalyzed rows and
 * never runs out. Bounding by `last_message_at` means the backlog drains to zero
 * and stays there, and old mail stays queryable as metadata without costing a
 * single token. Users can still analyze any individual thread on demand via
 * `analyzeThread`, or pass `allTime` to sweep everything deliberately.
 */
export async function analyzeUnanalyzedThreads(
  userId: string,
  opts: BatchAnalysisOptions | number = {},
): Promise<number> {
  // ponytail: numeric arg kept working — call sites passed a bare limit.
  const { limit = 20, withinDays, allTime = false } = typeof opts === 'number' ? { limit: opts } : opts;
  const windowDays = allTime ? null : (withinDays ?? await getSyncDays(userId));

  const res = await db.query(
    `SELECT et.id, et.subject FROM email_threads et
     LEFT JOIN email_analysis ea ON ea.thread_id = et.id
     WHERE et.user_id = $1 AND ea.id IS NULL
       AND ($3::int IS NULL OR et.last_message_at >= now() - ($3::int * INTERVAL '1 day'))
     ORDER BY et.last_message_at DESC
     LIMIT $2`,
    [userId, limit, windowDays],
  );

  console.log(
    `[email-ai] user ${userId} — ${res.rows.length} thread(s) queued` +
    (windowDays === null ? ' (all time, explicit request)' : ` from the last ${windowDays} day(s)`),
  );

  const total = res.rows.length;
  const progress: AnalysisProgress = {
    status: 'running',
    total,
    processed: 0,
    remaining: total,
    percentage: 0,
    currentThread: null,
    errors: 0,
    startedAt: Date.now(),
    completedAt: null,
  };
  emitProgress(userId, progress);

  let analyzed = 0;
  for (const row of res.rows) {
    const updated = {
      ...progress,
      currentThread: row.subject ?? row.id,
      remaining: total - progress.processed,
    };
    emitProgress(userId, updated);

    try {
      await analyzeThread(row.id, userId);
      analyzed++;
      progress.processed = analyzed + progress.errors;
      progress.percentage = total > 0 ? Math.round(((analyzed + progress.errors) / total) * 100) : 0;
      progress.remaining = total - progress.processed;
      emitProgress(userId, { ...progress, currentThread: row.subject ?? row.id });
      await sleep(1500);
    } catch (err) {
      console.warn(`[email-ai] Failed to analyze thread ${row.id}:`, (err as Error).message);
      progress.errors++;
      progress.processed = analyzed + progress.errors;
      progress.percentage = total > 0 ? Math.round(((analyzed + progress.errors) / total) * 100) : 0;
      progress.remaining = total - progress.processed;
      emitProgress(userId, { ...progress, currentThread: row.subject ?? row.id });
    }
  }

  const final: AnalysisProgress = {
    ...progress,
    status: 'completed',
    processed: total,
    remaining: 0,
    percentage: 100,
    currentThread: null,
    completedAt: Date.now(),
  };
  emitProgress(userId, final);

  return analyzed;
}

// ─── Follow-up detection ────────────────────────────────────────────────────

export async function detectFollowUps(userId: string, daysThreshold = DEFAULT_FOLLOW_UP_DAYS): Promise<number> {
  // Bounded by the same window as analysis: a thread that went quiet months ago
  // is not a follow-up the user wants surfaced today.
  const windowDays = await getSyncDays(userId);
  const res = await db.query(
    `SELECT et.id, et.subject, e_last.sent_at, e_last.is_sent_by_user
     FROM email_threads et
     JOIN LATERAL (
       SELECT sent_at, is_sent_by_user FROM emails
       WHERE thread_id = et.id ORDER BY sent_at DESC LIMIT 1
     ) e_last ON true
     WHERE et.user_id = $1
       AND e_last.is_sent_by_user = true
       AND e_last.sent_at < now() - ($2::int * INTERVAL '1 day')
       AND e_last.sent_at >= now() - ($3::int * INTERVAL '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM email_follow_ups ef
         WHERE ef.thread_id = et.id AND ef.status = 'pending'
       )`,
    [userId, daysThreshold, windowDays],
  );

  let created = 0;
  for (const row of res.rows) {
    const daysWaiting = Math.floor((Date.now() - new Date(row.sent_at).getTime()) / (1000 * 60 * 60 * 24));
    await db.query(
      `INSERT INTO email_follow_ups (thread_id, user_id, reason, days_waiting, due_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'pending')`,
      [row.id, userId, `No response for ${daysWaiting} days after your last message`, daysWaiting],
    );
    created++;
  }
  return created;
}

// ─── Dashboard queries ──────────────────────────────────────────────────────

export async function getFollowUpDashboard(userId: string) {
  const [pending, overdue, dueToday, dueThisWeek] = await Promise.all([
    db.query(
      `SELECT ef.*, et.subject FROM email_follow_ups ef
       JOIN email_threads et ON et.id = ef.thread_id
       WHERE ef.user_id = $1 AND ef.status = 'pending'
       ORDER BY ef.due_date ASC NULLS LAST`,
      [userId],
    ),
    db.query(
      `SELECT ef.*, et.subject FROM email_follow_ups ef
       JOIN email_threads et ON et.id = ef.thread_id
       WHERE ef.user_id = $1 AND ef.status = 'pending' AND ef.due_date < CURRENT_DATE
       ORDER BY ef.due_date ASC`,
      [userId],
    ),
    db.query(
      `SELECT ef.*, et.subject FROM email_follow_ups ef
       JOIN email_threads et ON et.id = ef.thread_id
       WHERE ef.user_id = $1 AND ef.status = 'pending' AND ef.due_date = CURRENT_DATE`,
      [userId],
    ),
    db.query(
      `SELECT ef.*, et.subject FROM email_follow_ups ef
       JOIN email_threads et ON et.id = ef.thread_id
       WHERE ef.user_id = $1 AND ef.status = 'pending'
         AND ef.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
       ORDER BY ef.due_date ASC`,
      [userId],
    ),
  ]);

  const mapRow = (r: Record<string, unknown>) => ({
    id: r.id,
    threadId: r.thread_id,
    subject: r.subject,
    reason: r.reason,
    dueDate: r.due_date,
    daysWaiting: r.days_waiting,
    suggestedMessage: r.suggested_message,
    status: r.status,
  });

  return {
    pending: pending.rows.map(mapRow),
    overdue: overdue.rows.map(mapRow),
    dueToday: dueToday.rows.map(mapRow),
    dueThisWeek: dueThisWeek.rows.map(mapRow),
  };
}

export async function getActionItemDashboard(userId: string) {
  const [open, completed, highPriority, clientDependent] = await Promise.all([
    db.query(
      `SELECT ai.*, et.subject FROM email_action_items ai
       JOIN email_threads et ON et.id = ai.thread_id
       WHERE ai.user_id = $1 AND ai.status = 'open'
       ORDER BY CASE ai.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      [userId],
    ),
    db.query(
      `SELECT COUNT(*) FROM email_action_items WHERE user_id = $1 AND status = 'completed'`,
      [userId],
    ),
    db.query(
      `SELECT ai.*, et.subject FROM email_action_items ai
       JOIN email_threads et ON et.id = ai.thread_id
       WHERE ai.user_id = $1 AND ai.status = 'open' AND ai.priority IN ('high', 'critical')
       ORDER BY ai.created_at DESC`,
      [userId],
    ),
    db.query(
      `SELECT ai.*, et.subject FROM email_action_items ai
       JOIN email_threads et ON et.id = ai.thread_id
       WHERE ai.user_id = $1 AND ai.status = 'open' AND ai.owner IS NOT NULL AND ai.owner != ''
       ORDER BY ai.created_at DESC`,
      [userId],
    ),
  ]);

  const mapRow = (r: Record<string, unknown>) => ({
    id: r.id,
    threadId: r.thread_id,
    subject: r.subject,
    task: r.task,
    owner: r.owner,
    dueHint: r.due_hint,
    priority: r.priority,
    status: r.status,
  });

  return {
    open: open.rows.map(mapRow),
    completedCount: parseInt(completed.rows[0].count, 10),
    highPriority: highPriority.rows.map(mapRow),
    clientDependent: clientDependent.rows.map(mapRow),
  };
}

export async function updateActionItemStatus(
  itemId: string,
  userId: string,
  status: 'open' | 'completed' | 'dismissed',
): Promise<boolean> {
  const res = await db.query(
    `UPDATE email_action_items SET status = $3, completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE NULL END
     WHERE id = $1 AND user_id = $2`,
    [itemId, userId, status],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function updateFollowUpStatus(
  followUpId: string,
  userId: string,
  status: 'pending' | 'completed' | 'snoozed' | 'dismissed',
): Promise<boolean> {
  const res = await db.query(
    `UPDATE email_follow_ups SET status = $3, completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE NULL END
     WHERE id = $1 AND user_id = $2`,
    [followUpId, userId, status],
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── Daily Brief ────────────────────────────────────────────────────────────

export async function generateDailyBrief(userId: string): Promise<DailyBrief> {
  const today = new Date().toISOString().split('T')[0];

  const [followUpsRes, actionsRes, newThreadsRes, unrepliedRes] = await Promise.all([
    db.query(
      `SELECT ef.thread_id, et.subject, ef.reason, ef.days_waiting
       FROM email_follow_ups ef
       JOIN email_threads et ON et.id = ef.thread_id
       WHERE ef.user_id = $1 AND ef.status = 'pending'
       ORDER BY ef.days_waiting DESC NULLS LAST
       LIMIT 10`,
      [userId],
    ),
    db.query(
      `SELECT ai.thread_id, et.subject, ai.task, ai.priority
       FROM email_action_items ai
       JOIN email_threads et ON et.id = ai.thread_id
       WHERE ai.user_id = $1 AND ai.status = 'open'
       ORDER BY CASE ai.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
       LIMIT 10`,
      [userId],
    ),
    db.query(
      `SELECT COUNT(*) FROM email_threads
       WHERE user_id = $1 AND first_message_at >= CURRENT_DATE - INTERVAL '1 day'`,
      [userId],
    ),
    db.query(
      `SELECT COUNT(*) FROM email_threads et
       WHERE et.user_id = $1 AND et.is_unread = true`,
      [userId],
    ),
  ]);

  const followUps = followUpsRes.rows.map(r => ({
    threadId: r.thread_id,
    subject: r.subject,
    reason: r.reason,
    daysWaiting: r.days_waiting ?? 0,
  }));

  const pendingActions = actionsRes.rows.map(r => ({
    threadId: r.thread_id,
    subject: r.subject,
    task: r.task,
    priority: r.priority,
  }));

  const newThreads = parseInt(newThreadsRes.rows[0].count, 10);
  const unrepliedCount = parseInt(unrepliedRes.rows[0].count, 10);

  const briefLines: string[] = [`Today's Email Brief (${today}):`];
  if (followUps.length > 0) {
    briefLines.push('', 'Follow-ups needed:');
    for (const f of followUps.slice(0, 5)) {
      briefLines.push(`  - "${f.subject}" — ${f.reason}`);
    }
  }
  if (pendingActions.length > 0) {
    briefLines.push('', 'Action items:');
    for (const a of pendingActions.slice(0, 5)) {
      briefLines.push(`  - [${a.priority.toUpperCase()}] ${a.task} (re: "${a.subject}")`);
    }
  }
  if (unrepliedCount > 0) {
    briefLines.push('', `${unrepliedCount} unread email thread(s) awaiting attention.`);
  }
  if (newThreads > 0) {
    briefLines.push(`${newThreads} new thread(s) received in the last 24 hours.`);
  }

  return {
    date: today,
    followUps,
    pendingActions,
    newThreads,
    unrepliedCount,
    briefText: briefLines.join('\n'),
  };
}

// ─── Get stored analysis ────────────────────────────────────────────────────

export async function getStoredAnalysis(threadId: string) {
  const res = await db.query('SELECT * FROM email_analysis WHERE thread_id = $1', [threadId]);
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return {
    summary: r.summary,
    status: r.status,
    keyPoints: r.key_points ?? [],
    decisions: r.decisions ?? [],
    risks: r.risks ?? [],
    followUpNeeded: r.follow_up_needed,
    followUpReason: r.follow_up_reason,
    suggestedReply: r.suggested_reply,
    nextAction: r.next_action,
    analyzedAt: r.analyzed_at,
  };
}
