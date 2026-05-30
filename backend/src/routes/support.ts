import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { config } from '../config';
import { getUserById } from '../services/googleAuth';

const router = Router();

// Require auth
router.use((req: Request, res: Response, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
});

const ISSUE_LABELS: Record<string, string> = {
  'bot-unable-to-join':        'Bot unable to join meeting',
  'bot-joined-no-record':      'Bot joined but didn\'t record',
  'recording-incomplete':      'Recording missing or incomplete',
  'auto-join-failed':          'Auto-join didn\'t work',
  'transcript-not-generated':  'Transcript not generated',
  'summary-missing':           'AI summary missing',
  'other':                     'Other issue',
};

// POST /api/support
router.post('/', async (req: Request, res: Response) => {
  const { issueType, message } = req.body as { issueType?: string; message?: string };

  // Validate
  if (!issueType || !ISSUE_LABELS[issueType]) {
    res.status(400).json({ error: 'Please select an issue type.' });
    return;
  }
  const trimmed = (message || '').trim();
  if (!trimmed) {
    res.status(400).json({ error: 'Please describe your issue.' });
    return;
  }
  if (trimmed.length > 5000) {
    res.status(400).json({ error: 'Message too long (max 5000 characters).' });
    return;
  }

  const issueLabel = ISSUE_LABELS[issueType];
  const userId = req.session.userId!;
  const submittedAt = new Date().toISOString();

  // Fetch user details so we can include email in the ticket
  const user = await getUserById(userId).catch(() => null);
  const userEmail = user?.email ?? 'unknown';
  const userName  = user?.name  ?? 'unknown';

  // Always log so nothing is silently dropped
  console.log(`[support] Ticket from user ${userId} (${userEmail})`);
  console.log(`[support]   Issue:   ${issueLabel}`);
  console.log(`[support]   Message: ${trimmed}`);

  // Send email if SMTP is configured
  const smtpReady = config.smtp.host && config.smtp.user && config.smtp.pass && config.supportEmail;
  if (smtpReady) {
    try {
      const transporter = nodemailer.createTransport({
        host:   config.smtp.host,
        port:   config.smtp.port,
        secure: config.smtp.port === 465,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      });

      await transporter.sendMail({
        from:    config.smtp.from,
        to:      config.supportEmail,
        subject: `[NoteAI Support] ${issueLabel}`,
        text: [
          `Issue Type: ${issueLabel}`,
          `User:       ${userName} <${userEmail}>`,
          `User ID:    ${userId}`,
          `Submitted:  ${submittedAt}`,
          '',
          'Message:',
          trimmed,
        ].join('\n'),
        html: `
          <table style="font-family:sans-serif;font-size:14px;color:#333;border-collapse:collapse;width:100%;max-width:600px">
            <tr><td style="padding:4px 8px 4px 0"><strong>Issue type:</strong></td><td>${issueLabel}</td></tr>
            <tr><td style="padding:4px 8px 4px 0"><strong>Name:</strong></td><td>${userName}</td></tr>
            <tr><td style="padding:4px 8px 4px 0"><strong>Email:</strong></td><td><a href="mailto:${userEmail}">${userEmail}</a></td></tr>
            <tr><td style="padding:4px 8px 4px 0"><strong>User ID:</strong></td><td style="font-family:monospace;font-size:12px">${userId}</td></tr>
            <tr><td style="padding:4px 8px 4px 0"><strong>Submitted:</strong></td><td>${submittedAt}</td></tr>
          </table>
          <hr style="margin:16px 0;border:none;border-top:1px solid #eee"/>
          <p style="font-family:sans-serif;font-size:14px;color:#333;white-space:pre-wrap">${trimmed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
        `,
      });

      console.log(`[support] Email sent to ${config.supportEmail}`);
    } catch (err) {
      // Email failure is non-fatal — ticket was already logged
      console.error('[support] Email delivery failed:', (err as Error).message);
    }
  } else {
    console.log('[support] SMTP not configured — ticket logged only (set SUPPORT_EMAIL + SMTP_* in .env to enable email)');
  }

  res.json({ ok: true });
});

export default router;