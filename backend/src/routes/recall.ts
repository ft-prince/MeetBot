/**
 * Recall.ai routes
 *
 * POST /api/recall/webhook          ← Recall posts real-time transcript + status here
 * POST /api/recall/launch           ← manually launch a bot (for testing)
 * GET  /api/recall/:botId/status    ← check bot status
 * POST /api/recall/:botId/stop      ← stop a bot
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { getBot, stopBot, latestStatus } from '../services/recallService';
import { botIdToMeetingCode } from '../bot/recallBot';
import { forwardRecallSegment } from '../ws/ingestHandler';
import { botManager } from '../bot/botManager';

const router = Router();

// ── Webhook ────────────────────────────────────────────────────────────────────
//
// Recall POSTs here for every real-time transcript chunk and status change.
// We use express.raw() so we have the raw body for HMAC signature verification.
//
router.post(
  '/webhook',
  // Raw body needed for signature verification
  (req, res, next) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      (req as any).rawBody = data;
      try { (req as any).parsedBody = JSON.parse(data); } catch {}
      next();
    });
  },
  (req: Request, res: Response) => {
    // ── Signature verification (optional but recommended) ────────────────────
    const secret = config.recall.webhookSecret?.trim();
    if (secret) {
      const sigHeader = req.headers['recall-signature'] as string | undefined;
      if (sigHeader) {
        // Recall signature format: "t=<timestamp>,v1=<hmac>"
        const parts = Object.fromEntries(
          sigHeader.split(',').map(p => p.split('=') as [string, string])
        );
        const timestamp = parts['t'];
        const expectedSig = parts['v1'];
        if (timestamp && expectedSig) {
          const payload = `${timestamp}.${(req as any).rawBody}`;
          // Strip "whsec_" prefix and base64-decode the secret
          const secretKey = secret.startsWith('whsec_')
            ? Buffer.from(secret.slice(6), 'base64')
            : Buffer.from(secret);
          const computed = crypto
            .createHmac('sha256', secretKey)
            .update(payload)
            .digest('hex');
          if (computed !== expectedSig) {
            console.warn('[recall-webhook] Signature mismatch — request rejected');
            return res.sendStatus(401);
          }
        }
      }
    }

    const body = (req as any).parsedBody;
    if (!body) return res.sendStatus(400);

    const { event, data } = body as {
      event: string;
      data: Record<string, unknown>;
    };

    const botId = data?.bot_id as string | undefined;

    console.log(`[recall-webhook] event=${event} botId=${botId}`);

    // ── Real-time transcript segment ─────────────────────────────────────────
    if (event === 'transcript.data') {
      const rt = data?.real_time_transcription as Record<string, unknown> | undefined;
      if (!rt || !botId) return res.sendStatus(200);

      const meetingCode = botIdToMeetingCode.get(botId);
      if (!meetingCode) {
        console.warn(`[recall-webhook] No meetingCode for botId=${botId}`);
        return res.sendStatus(200);
      }

      const participant = rt.participant as Record<string, unknown> | undefined;
      const words = (rt.words as Array<Record<string, unknown>>) ?? [];
      const text = words.map(w => w.text as string).join(' ').trim();
      if (!text) return res.sendStatus(200);

      const firstWord = words[0] ?? {};
      const lastWord = words[words.length - 1] ?? {};
      const startTs = (firstWord.start_timestamp as Record<string, number> | undefined)?.relative ?? 0;
      const endTs = (lastWord.end_timestamp as Record<string, number> | undefined)?.relative ?? startTs;

      forwardRecallSegment(meetingCode, {
        speakerName: (participant?.name as string) || null,
        speakerLabel: `recall-${participant?.id ?? 0}`,
        text,
        startMs: Math.round(startTs * 1000),
        endMs: Math.round(endTs * 1000),
        isFinal: (rt.is_final as boolean) ?? true,
      });
    }

    // ── Bot status change ────────────────────────────────────────────────────
    if (event === 'bot.status_change') {
      const status = (data?.status as Record<string, string> | undefined)?.code;
      console.log(`[recall-webhook] Bot ${botId} status → ${status}`);
      // Terminal statuses are also handled by the poll loop in RecallBot,
      // but handling here ensures faster cleanup when webhook is available.
    }

    res.sendStatus(200);
  }
);

// ── Status ─────────────────────────────────────────────────────────────────────
router.get('/:botId/status', async (req, res) => {
  try {
    const bot = await getBot(req.params.botId);
    res.json({
      code: latestStatus(bot),
      botName: bot.bot_name,
      recordings: bot.recordings ?? [],
      statusChanges: bot.status_changes ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Stop ───────────────────────────────────────────────────────────────────────
router.post('/:botId/stop', async (req, res) => {
  try {
    await stopBot(req.params.botId);
    console.log(`[recall] Bot ${req.params.botId} stopped via API`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Manual launch (testing only) ───────────────────────────────────────────────
router.post('/launch', async (req, res) => {
  try {
    const { meetingUrl } = req.body ?? {};
    if (!meetingUrl) return res.status(400).json({ error: 'meetingUrl required' });
    const meetingCode = await botManager.launch(meetingUrl);
    res.json({ meetingCode, ok: true });
  } catch (err) {
    console.error('[recall] Manual launch failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
