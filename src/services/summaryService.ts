import Groq from 'groq-sdk';
import { config } from '../config';

export interface MeetingSummary {
  summary: string;
  keyInsights: string[];
}

let groqClient: Groq | null = null;

function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: config.groq.apiKey });
  }
  return groqClient;
}

/**
 * Generate a detailed AI summary from transcript segments.
 * Returns empty result if Groq is not configured or transcript is too short.
 */
export async function generateSummary(
  segments: { speakerName?: string | null; speakerLabel?: string; text: string; startMs: number }[],
  title?: string
): Promise<MeetingSummary> {
  if (!config.groq.apiKey) {
    console.warn('[summary] GROQ_API_KEY not set — skipping summary');
    return { summary: '', keyInsights: [] };
  }

  if (!segments || segments.length === 0) {
    return { summary: '', keyInsights: [] };
  }

  // Format transcript as readable text
  const transcript = segments
    .map((s) => {
      const speaker = s.speakerName || s.speakerLabel || 'Unknown';
      const time = formatTime(s.startMs);
      return `[${time}] ${speaker}: ${s.text}`;
    })
    .join('\n');

  if (transcript.trim().length < 100) {
    return { summary: 'Meeting too short to summarize.', keyInsights: [] };
  }

  const prompt = `You are a professional meeting intelligence assistant. Analyze this meeting transcript and provide a detailed summary.

The transcript may contain Hinglish (Hindi + English mixed). Understand both languages and respond in English.

Meeting title: ${title || 'Team Meeting'}

Transcript:
${transcript.slice(0, 12000)}

Provide a detailed analysis in this EXACT JSON format (no markdown, no extra text):
{
  "summary": "A detailed 5-8 sentence summary covering the main topics discussed, decisions made, and overall meeting outcome.",
  "key_insights": [
    "Action item or key decision 1",
    "Action item or key decision 2",
    "Action item or key decision 3",
    "Action item or key decision 4",
    "Action item or key decision 5"
  ]
}`;

  try {
    const response = await getGroq().chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
    });

    let raw = response.choices[0]?.message?.content?.trim() || '';

    // Strip markdown code blocks if present
    if (raw.includes('```')) {
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) raw = match[1].trim();
    }

    const parsed = JSON.parse(raw);
    const summary = (parsed.summary || '').trim();
    const keyInsights: string[] = Array.isArray(parsed.key_insights)
      ? parsed.key_insights.filter((i: unknown) => typeof i === 'string' && i.trim())
      : [];

    console.log(`[summary] Generated: ${summary.slice(0, 60)}... (${keyInsights.length} insights)`);
    return { summary, keyInsights };
  } catch (err) {
    console.error('[summary] Groq API error:', (err as Error).message);
    return { summary: '', keyInsights: [] };
  }
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
