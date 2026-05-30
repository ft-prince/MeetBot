import { Router, Request, Response } from 'express';
import { config } from '../config';
import { broadcastToMeeting } from '../ws/ingestHandler';

const router = Router();

// POST /recall/webhook — receives real-time events from Recall AI
// Configure this URL in the Recall dashboard under Webhooks.
// The signing secret (RECALL_WEBHOOK_SECRET) verifies the payload.
router.post('/webhook', (req: Request, res: Response) => {
  // Verify webhook signature when secret is configured
  const secret = config.recall.webhookSecret;
  if (secret) {
    const signature = req.headers['x-recall-signature'] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }
    // TODO: implement HMAC-SHA256 verification using secret when going to production
    // For now, log a warning and allow through during development
    console.warn('[recall-webhook] Signature verification not yet implemented');
  }

  const event = req.body as {
    event: string;
    data?: {
      bot_id?: string;
      transcript?: { speaker: string; words: unknown[] };
      status?: { code: string };
    };
  };

  console.log(`[recall-webhook] Event: ${event.event}`, JSON.stringify(event.data ?? {}).slice(0, 200));

  // Real-time transcript event
  if (event.event === 'bot.transcription_data' && event.data?.transcript) {
    const { speaker, words } = event.data.transcript;
    // Words arrive incrementally — broadcast to any connected panel clients
    // The meetingCode is not included in the webhook payload directly; you
    // would need to map bot_id → meetingCode via activeRecallBots.
    // This is wired up as a future enhancement — polling handles the base case.
    console.log(`[recall-webhook] Transcript chunk from "${speaker}": ${(words ?? []).length} words`);
  }

  // Bot status change
  if (event.event === 'bot.status_change') {
    const code = event.data?.status?.code;
    console.log(`[recall-webhook] Bot ${event.data?.bot_id} status → ${code}`);
  }

  res.json({ ok: true });
});

export default router;