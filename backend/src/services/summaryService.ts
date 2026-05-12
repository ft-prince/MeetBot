import Groq from 'groq-sdk';
import { config } from '../config';

export interface MeetingSummary {
  summary: string;
  keyInsights: string[];
  detailedRewrite: string;
  importantPoints: string[];
}

let groqClient: Groq | null = null;

function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: config.groq.apiKey });
  }
  return groqClient;
}

export async function generateSummary(
  segments: { speakerName?: string | null; speakerLabel?: string; text: string; startMs: number }[],
  title?: string
): Promise<MeetingSummary> {
  const empty: MeetingSummary = { summary: '', keyInsights: [], detailedRewrite: '', importantPoints: [] };

  if (!config.groq.apiKey) {
    console.warn('[summary] GROQ_API_KEY not set — skipping summary');
    return empty;
  }

  if (!segments || segments.length === 0) return empty;

  const transcript = segments
    .map(s => {
      const speaker = s.speakerName || s.speakerLabel || 'Unknown';
      const time = formatTime(s.startMs);
      return `[${time}] ${speaker}: ${s.text}`;
    })
    .join('\n');

  if (transcript.trim().length < 100) {
    return { ...empty, summary: 'Meeting too short to summarize.' };
  }

  // Devanagari/CJK chars cost 2-3x tokens vs English — keep slice small to stay under TPM limit
  const transcriptSlice = transcript.slice(0, 5000)

  const prompt = `You are a meeting intelligence assistant. The transcript may contain Hinglish (Hindi+English). Respond in English only.

Meeting: ${title || 'Team Meeting'}

Transcript:
${transcriptSlice}

Return ONLY valid JSON, no markdown:
{"detailed_rewrite":"narrative rewrite 6-10 sentences","summary":"3-5 sentence executive summary","key_insights":["action item or decision x5"],"important_points":["key fact or deadline x4"]}`;

  try {
    const response = await getGroq().chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2500,
    });

    let raw = response.choices[0]?.message?.content?.trim() || '';
    if (raw.includes('```')) {
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) raw = match[1].trim();
    }

    const parsed = JSON.parse(raw);

    const detailedRewrite = (parsed.detailed_rewrite || '').trim();
    const summary       = (parsed.summary || '').trim();
    const keyInsights: string[] = Array.isArray(parsed.key_insights)
      ? parsed.key_insights.filter((i: unknown) => typeof i === 'string' && i.trim())
      : [];
    const importantPoints: string[] = Array.isArray(parsed.important_points)
      ? parsed.important_points.filter((i: unknown) => typeof i === 'string' && i.trim())
      : [];

    console.log(`[summary] Generated: "${summary.slice(0, 60)}…" (${keyInsights.length} insights, ${importantPoints.length} points)`);
    return { detailedRewrite, summary, keyInsights, importantPoints };
  } catch (err) {
    console.error('[summary] Groq API error:', (err as Error).message);
    return empty;
  }
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
