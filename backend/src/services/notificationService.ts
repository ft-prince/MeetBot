/**
 * Notification Service — post-meeting email delivery over SMTP.
 *
 *   • sendMeetingSummaryEmail — fires right after the AI pipeline finishes:
 *     meeting title/date/duration, executive summary, decisions, action items,
 *     dashboard + transcript links, and the professional PDF report attached.
 *   • sendMeetingReminderEmail — nudges the owner about a completed meeting
 *     they haven't opened yet (driven by the scheduler; stops once viewed).
 *
 * Both are best-effort: failures are logged, never thrown into the pipeline.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import {
  getMeetingReportData,
  markSummaryEmailSent,
  markReminderSent,
  type MeetingReportData,
} from './meetingService';
import { generateMeetingPdf } from './pdfService';
import { diag } from './diag';

let transporter: Transporter | null = null;

export function smtpConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

/** Test seam — inject a fake transporter (e.g. jsonTransport) in tests. */
export function setTransporterForTests(t: Transporter | null): void {
  transporter = t;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function listHtml(items: string[]): string {
  return `<ul style="margin:6px 0 0;padding-left:18px">${items
    .map(i => `<li style="margin-bottom:5px;line-height:1.45">${esc(i)}</li>`)
    .join('')}</ul>`;
}

function section(title: string, bodyHtml: string): string {
  return `
    <tr><td style="padding:14px 24px 0">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#e8590c">${esc(title)}</div>
      <div style="font-size:14px;color:#1f2430;margin-top:4px">${bodyHtml}</div>
    </td></tr>`;
}

function buildSummaryEmailHtml(data: MeetingReportData): string {
  const title = data.title || `Meeting ${data.meetingCode}`;
  const dashboardUrl = `${config.appBaseUrl}/meetings/${data.id}`;
  const transcriptUrl = `${dashboardUrl}?tab=transcript`;

  const actionItems = (data.actionItems as { task: string; owner: string | null; dueHint: string | null }[]) || [];
  const actionsHtml = actionItems.length
    ? `<ol style="margin:6px 0 0;padding-left:18px">${actionItems
        .map(a => `<li style="margin-bottom:6px;line-height:1.45">${esc(a.task)}${
          a.owner ? ` <span style="color:#e8590c;font-weight:600">· ${esc(a.owner)}</span>` : ''
        }${a.dueHint ? ` <span style="color:#b45309;font-weight:600">· due ${esc(a.dueHint)}</span>` : ''}</li>`)
        .join('')}</ol>`
    : '<div style="color:#6b7280">No action items were identified.</div>';

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
        <tr><td style="background:#e8590c;height:6px"></td></tr>
        <tr><td style="padding:24px 24px 0">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:#6b7280">MEETMASTER · MEETING RESULTS</div>
          <div style="font-size:21px;font-weight:800;color:#1f2430;margin-top:6px">${esc(title)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:6px">
            ${esc(fmtDate(data.startedAt))} &nbsp;·&nbsp; ${esc(fmtDuration(data.durationMs))}
            ${data.participants.length ? ` &nbsp;·&nbsp; ${data.participants.length} participant${data.participants.length === 1 ? '' : 's'}` : ''}
          </div>
        </td></tr>
        ${data.summary ? section('AI Summary', `<div style="line-height:1.55;white-space:pre-line">${esc(data.summary)}</div>`) : ''}
        ${data.decisions.length ? section('Important Decisions', listHtml(data.decisions)) : ''}
        ${section('Key Action Items', actionsHtml)}
        ${data.nextMeeting ? section('Next Meeting', esc(data.nextMeeting)) : ''}
   
        <tr><td style="padding:0 24px 24px">
          <div style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px">
            A professionally formatted PDF report is attached. You're receiving this because your MeetMaster bot recorded this meeting.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function buildSummaryEmailText(data: MeetingReportData): string {
  const title = data.title || `Meeting ${data.meetingCode}`;
  const actionItems = (data.actionItems as { task: string; owner: string | null; dueHint: string | null }[]) || [];
  return [
    `Meeting results: ${title}`,
    `Date: ${fmtDate(data.startedAt)}`,
    `Duration: ${fmtDuration(data.durationMs)}`,
    '',
    'AI SUMMARY',
    data.summary || '(no summary)',
    '',
    data.decisions.length ? `DECISIONS\n${data.decisions.map(d => `- ${d}`).join('\n')}\n` : '',
    actionItems.length
      ? `ACTION ITEMS\n${actionItems.map((a, i) => `${i + 1}. ${a.task}${a.owner ? ` (owner: ${a.owner})` : ''}${a.dueHint ? ` (due: ${a.dueHint})` : ''}`).join('\n')}\n`
      : '',
    `Dashboard: ${config.appBaseUrl}/meetings/${data.id}`,
  ].filter(Boolean).join('\n');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Email the meeting owner their results as soon as processing completes.
 * No-op when SMTP isn't configured, emails are disabled, there is no owner,
 * or this meeting's results email was already sent (idempotent).
 */
export async function sendMeetingSummaryEmail(meetingId: string): Promise<boolean> {
  if (!config.meetingEmails) return false;
  if (!smtpConfigured()) {
    console.log('[notify] SMTP not configured — skipping post-meeting email (set SMTP_* in .env)');
    return false;
  }

  const data = await getMeetingReportData(meetingId);
  if (!data) { console.warn(`[notify] No meeting ${meetingId} — skipping email`); return false; }
  if (!data.owner?.email) {
    console.log(`[notify] Meeting ${meetingId} has no owner — skipping email`);
    return false;
  }

  // Idempotence guard against double pipeline runs.
  const already = await alreadySent(meetingId);
  if (already) return false;

  let pdf: Buffer | null = null;
  try {
    pdf = await generateMeetingPdf(data);
  } catch (err) {
    console.error(`[notify] PDF generation failed for ${meetingId}: ${(err as Error).message} — sending email without attachment`);
  }

  const title = data.title || `Meeting ${data.meetingCode}`;
  try {
    await getTransporter().sendMail({
      from: config.smtp.from,
      to: data.owner.email,
      subject: `Meeting results: ${title} — ${fmtDate(data.startedAt)}`,
      text: buildSummaryEmailText(data),
      html: buildSummaryEmailHtml(data),
      attachments: pdf
        ? [{
            filename: `Meeting Report - ${(data.title || data.meetingCode).replace(/[\\/:*?"<>|]/g, '_')}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          }]
        : [],
    });
    await markSummaryEmailSent(meetingId);
    console.log(`[notify] Results email sent to ${data.owner.email} for ${meetingId}`);
    diag(`EMAIL sent meeting-results for ${data.meetingCode} → ${data.owner.email}`);
    return true;
  } catch (err) {
    console.error(`[notify] Results email FAILED for ${meetingId}: ${(err as Error).message}`);
    diag(`⚠ EMAIL FAILED meeting-results for ${data.meetingCode}: ${(err as Error).message}`);
    return false;
  }
}

async function alreadySent(meetingId: string): Promise<boolean> {
  const { db } = await import('../db/client');
  const r = await db.query('SELECT summary_email_sent_at FROM meetings WHERE id = $1', [meetingId]);
  return Boolean(r.rows[0]?.summary_email_sent_at);
}

/**
 * Remind the owner about a completed meeting they haven't viewed yet.
 * Caller (scheduler) is responsible for selecting which meetings qualify.
 */
export async function sendMeetingReminderEmail(m: {
  id: string; title: string | null; meetingCode: string; endedAt: Date;
  ownerEmail: string; ownerName: string;
}): Promise<boolean> {
  if (!smtpConfigured()) return false;
  const title = m.title || `Meeting ${m.meetingCode}`;
  const url = `${config.appBaseUrl}/meetings/${m.id}`;
  try {
    await getTransporter().sendMail({
      from: config.smtp.from,
      to: m.ownerEmail,
      subject: `Reminder: unread meeting notes — ${title}`,
      text: [
        `Hi ${m.ownerName},`,
        '',
        `You haven't opened the notes for "${title}" (ended ${fmtDate(m.endedAt)}).`,
        `The AI summary, action items, and transcript are ready in your dashboard:`,
        url,
        '',
        `This reminder stops once you open the meeting.`,
      ].join('\n'),
      html: `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
          <tr><td style="background:#e8590c;height:6px"></td></tr>
          <tr><td style="padding:24px">
            <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:#6b7280">MEETMASTER · REMINDER</div>
            <div style="font-size:19px;font-weight:800;color:#1f2430;margin-top:6px">You have unread meeting notes</div>
            <p style="font-size:14px;color:#374151;line-height:1.55">Hi ${esc(m.ownerName)},<br/><br/>
              You haven't opened the notes for <strong>${esc(title)}</strong> (ended ${esc(fmtDate(m.endedAt))}).
              The AI summary, action items, and full transcript are waiting in your dashboard.</p>
            <a href="${url}" style="display:inline-block;background:#e8590c;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px">Open meeting notes</a>
            <p style="font-size:12px;color:#6b7280;margin-top:18px">This reminder stops as soon as you open the meeting.</p>
          </td></tr>
        </table></td></tr></table></body></html>`,
    });
    await markReminderSent(m.id);
    console.log(`[notify] Reminder sent to ${m.ownerEmail} for meeting ${m.id}`);
    return true;
  } catch (err) {
    console.error(`[notify] Reminder FAILED for ${m.id}: ${(err as Error).message}`);
    return false;
  }
}
