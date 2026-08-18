/**
 * AI Pipeline Service
 *
 * Tiered LLM analysis with graceful fallback:
 *   Primary  → structured JSON: summary, action items, insights, chapters, speakers, language
 *   Fallback → chunked summarization for long transcripts
 *   Fallback → trimmed single-shot summary
 *   Fallback → keyword extraction + lightweight stats (no LLM)
 *
 * Each module runs independently. Failures don't block other modules.
 * Retries: 3 attempts with exponential backoff (500ms → 1s → 2s).
 * Outputs scale with transcript length, speaker count, and meeting duration —
 * no hardcoded bullet/sentence/line counts.
 */
import Groq from 'groq-sdk';
import { config } from '../config';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineSegment {
  speakerName?: string | null;
  speakerLabel?: string | null;
  text: string;
  startMs: number;
  endMs?: number;
}

export interface ActionItem {
  task: string;
  owner: string | null;
  dueHint: string | null;
}

export interface Chapter {
  title: string;
  startMs: number;
  endMs: number;
  summary: string;
}

export interface SpeakerInsight {
  name: string;
  contributions: string[];
  ownership: string[];
  collaboration: string[];
}

export interface QAPair {
  question: string;
  answer: string | null;   // null = asked but never answered
  askedBy: string | null;
}

export type ModuleStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export interface ProcessingStatus {
  language?: ModuleStatus;
  summary?: ModuleStatus;
  actionItems?: ModuleStatus;
  insights?: ModuleStatus;
  chapters?: ModuleStatus;
  speakers?: ModuleStatus;
  questions?: ModuleStatus;
}

export interface PipelineResult {
  language: string | null;
  summary: string;
  detailedRewrite: string;
  keyInsights: string[];
  importantPoints: string[];
  actionItems: ActionItem[];
  keyQuestions: string[];
  chapters: Chapter[];
  speakerInsights: SpeakerInsight[];
  // Comprehensive-summary fields — everything a non-attendee needs.
  meetingObjective: string;
  discussionPoints: string[];
  decisions: string[];
  risks: string[];
  followUps: string[];
  nextMeeting: string | null;
  outcome: string;
  qaPairs: QAPair[];
  status: ProcessingStatus;
}

// ─── Constants (only safety bounds — no output-shape limits) ─────────────────

// Groq decommissions models without notice — llama-3.1-8b-instant started
// returning 404 and silently failed every module that needs JSON output.
// Override with GROQ_MODEL when Groq retires this one; check the live list at
// GET /openai/v1/models before picking a replacement (JSON mode is required).
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// Groq TPM bound. Devanagari/CJK ≈ 2-3x tokens/char, so this is conservative.
const MAX_TRANSCRIPT_CHARS_PER_CALL = 12_000;
const CHUNK_CHARS = 6_000;
const CHUNK_OVERLAP = 400;

const MIN_TRANSCRIPT_CHARS = 80;

// ─── Groq client ─────────────────────────────────────────────────────────────

let groqClient: Groq | null = null;
function getGroq(): Groq {
  if (!groqClient) groqClient = new Groq({ apiKey: config.groq.apiKey });
  return groqClient;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function transcriptToText(segments: PipelineSegment[]): string {
  return segments
    .map(s => {
      const speaker = s.speakerName || s.speakerLabel || 'Unknown';
      return `[${formatTime(s.startMs)}] ${speaker}: ${s.text}`;
    })
    .join('\n');
}

function uniqueSpeakers(segments: PipelineSegment[]): string[] {
  return [...new Set(segments.map(s => s.speakerName || s.speakerLabel || 'Unknown'))];
}

// Fit a newline-joined transcript into a char budget for a single LLM call.
// Crucially, when it's too long we DON'T just keep the head (which would make
// action-items/questions/chapters/speaker-insights ignore everything after the
// first ~10 minutes of a long meeting). Instead we keep lines sampled EVENLY
// across the whole meeting — plus the first and last line — so every module sees
// content spanning start→end. Line timestamps are preserved, so chapters still
// map to real times.
function condenseToBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lines = text.split('\n');
  if (lines.length <= 2) return text.slice(0, maxChars);

  const avgLen = text.length / lines.length;
  // 10% headroom so the joined sample fits WITHOUT a tail-chopping slice (which
  // would defeat the point by dropping the meeting's ending).
  let keep = Math.max(2, Math.floor((maxChars * 0.9) / Math.max(avgLen, 1)));
  if (keep >= lines.length) return text.slice(0, maxChars);

  const sampleIndices = (count: number): number[] => {
    const idxs: number[] = [];
    const seen = new Set<number>();
    const step = (lines.length - 1) / (count - 1); // spread first..last inclusive
    for (let k = 0; k < count; k++) {
      const idx = Math.min(lines.length - 1, Math.round(k * step));
      if (!seen.has(idx)) { seen.add(idx); idxs.push(idx); }
    }
    // Guarantee first and last are present.
    if (!seen.has(0)) idxs.unshift(0);
    if (!seen.has(lines.length - 1)) idxs.push(lines.length - 1);
    return idxs;
  };

  // Shrink until the joined result fits the budget; first & last always kept.
  let picked = sampleIndices(keep).map(i => lines[i]);
  while (picked.join('\n').length > maxChars && keep > 2) {
    keep = Math.max(2, Math.floor(keep * 0.85));
    picked = sampleIndices(keep).map(i => lines[i]);
  }
  const out = picked.join('\n');
  // Absolute last-resort guard (2 huge lines): keep head + tail, drop the middle.
  if (out.length > maxChars) {
    const half = Math.floor(maxChars / 2) - 1;
    return out.slice(0, half) + '\n' + out.slice(out.length - half);
  }
  return out;
}

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

// Parse Groq's "try again in 950ms" / "try again in 1.5s" hint from rate-limit errors.
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
      // Honor server's retry hint; otherwise exponential backoff with jitter.
      const hint = parseRetryHint(message);
      const base = hint ?? 800 * 2 ** i;
      const jitter = Math.floor(Math.random() * 200);
      const delay = base + jitter;
      console.warn(`[ai] ${label} attempt ${i + 1}/${attempts} failed${hint ? ` (server hint: ${hint}ms)` : ''}. Retrying in ${delay}ms…`);
      if (i < attempts - 1) await sleep(delay);
    }
  }
  throw lastErr;
}

async function groqJSON<T>(
  label: string,
  prompt: string,
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<T> {
  const model = opts.model ?? MODEL;
  // gpt-oss spends the SAME completion budget on its reasoning trace before it
  // emits any content. On a long transcript that exhausts max_tokens mid-thought
  // and Groq rejects the call with json_validate_failed + an empty generation.
  // Low effort keeps the budget for the answer. Only gpt-oss accepts this param.
  const reasoning = model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' as const } : {};

  return withRetry(label, async () => {
    const response = await getGroq().chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2500,
      response_format: { type: 'json_object' },
      ...reasoning,
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    const parsed = tryParseJSON<T>(raw);
    if (!parsed) throw new Error(`[${label}] LLM returned unparseable JSON`);
    return parsed;
  });
}

// ─── Module: language detection ──────────────────────────────────────────────

async function detectLanguage(transcript: string): Promise<string | null> {
  if (!config.groq.apiKey) return null;
  const sample = transcript.slice(0, 800);
  try {
    const parsed = await groqJSON<{ language: string }>(
      'detect-language',
      `Identify the primary language of this transcript snippet. If it mixes Hindi and English (Hinglish), return "hi-en". Use ISO 639-1 codes for single languages (e.g. "en", "hi", "es").

Snippet:
${sample}

Return ONLY JSON: {"language":"<code>"}`,
      { maxTokens: 60, temperature: 0 },
    );
    return parsed.language?.toLowerCase()?.trim() || null;
  } catch {
    return null;
  }
}

// ─── Module: summary (chunked + fallbacks) ───────────────────────────────────

function chunkTranscript(transcript: string): string[] {
  if (transcript.length <= CHUNK_CHARS) return [transcript];
  const chunks: string[] = [];
  let i = 0;
  while (i < transcript.length) {
    chunks.push(transcript.slice(i, i + CHUNK_CHARS));
    i += CHUNK_CHARS - CHUNK_OVERLAP;
  }
  return chunks;
}

interface SummaryStructured {
  detailed_rewrite?: string;
  summary?: string;
  key_insights?: string[];
  important_points?: string[];
  meeting_objective?: string;
  discussion_points?: string[];
  decisions?: string[];
  risks_blockers?: string[];
  follow_ups?: string[];
  next_meeting?: string | null;
  outcome?: string;
}

function langHintFor(language: string | null): string {
  if (language === 'hi-en') return 'The transcript is Hinglish (mixed Hindi-English). Respond in clear English.';
  if (language && language !== 'en') return `The transcript may be in language "${language}". Respond in clear English.`;
  return 'Respond in clear English.';
}

async function summarizeChunk(chunk: string, language: string | null): Promise<SummaryStructured> {
  return groqJSON<SummaryStructured>(
    'summary-chunk',
    `You are a meeting intelligence assistant. Your output must be detailed enough that someone who did NOT attend understands everything important without reading the transcript. ${langHintFor(language)}

Transcript chunk:
${chunk}

Return ONLY valid JSON with these exact keys:
{
  "summary": "executive summary: 2-4 substantial paragraphs separated by \\n\\n — what the meeting was about, what was discussed, what was decided, and where things stand now",
  "detailed_rewrite": "narrative rewrite covering everything important — length should match the content",
  "meeting_objective": "one or two sentences: why this meeting happened / what it set out to achieve",
  "discussion_points": ["each key topic that was discussed, with enough detail to be understood standalone"],
  "key_insights": ["each insight is an actionable decision, takeaway, or commitment"],
  "important_points": ["each point is a key fact, deadline, number, or named decision"],
  "decisions": ["each concrete decision that was made, including who made it if identifiable"],
  "risks_blockers": ["each risk, blocker, or concern raised"],
  "follow_ups": ["each follow-up item or topic deferred to later"],
  "next_meeting": "date/time/plan for the next meeting if one was mentioned, else null",
  "outcome": "one or two sentences: the overall outcome of the meeting"
}

Do not invent content. Scale each list to what the transcript supports; use [] or null when the transcript has nothing for a field.`,
    { maxTokens: 4000 },
  );
}

async function mergeSummaries(parts: SummaryStructured[], language: string | null): Promise<SummaryStructured> {
  if (parts.length === 1) return parts[0];
  const joined = parts.map((p, i) => `--- Chunk ${i + 1} ---
Objective: ${p.meeting_objective || ''}
Summary: ${p.summary || ''}
Discussion: ${(p.discussion_points || []).join(' | ')}
Insights: ${(p.key_insights || []).join(' | ')}
Points: ${(p.important_points || []).join(' | ')}
Decisions: ${(p.decisions || []).join(' | ')}
Risks/Blockers: ${(p.risks_blockers || []).join(' | ')}
Follow-ups: ${(p.follow_ups || []).join(' | ')}
Next meeting: ${p.next_meeting || ''}
Outcome: ${p.outcome || ''}`).join('\n\n');
  return groqJSON<SummaryStructured>(
    'summary-merge',
    `Merge these per-chunk meeting summaries into one cohesive output. Deduplicate, group related items, preserve all unique facts. The merged "summary" must be a 2-4 paragraph executive summary (paragraphs separated by \\n\\n) detailed enough for someone who did not attend. ${langHintFor(language)}

${joined}

Return ONLY JSON with these keys:
{"summary":"...","detailed_rewrite":"...","meeting_objective":"...","discussion_points":[...],"key_insights":[...],"important_points":[...],"decisions":[...],"risks_blockers":[...],"follow_ups":[...],"next_meeting":"... or null","outcome":"..."}`,
    { maxTokens: 4000 },
  );
}

function keywordFallback(transcript: string): SummaryStructured {
  const words = transcript.split(/\s+/);
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'have', 'are', 'was', 'will', 'you', 'but']);
  const freq = new Map<string, number>();
  for (const w of words) {
    const k = w.toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
    if (k.length < 4 || stop.has(k)) continue;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  const firstSentences = transcript.split(/[.!?]\s+/).slice(0, 3).join('. ');
  return {
    summary: firstSentences.slice(0, 400) || 'Summary unavailable — AI service offline.',
    detailed_rewrite: '',
    key_insights: top.slice(0, 5),
    important_points: top.slice(5, 10),
  };
}

async function runSummaryModule(
  transcript: string,
  language: string | null,
): Promise<{ result: SummaryStructured; status: ModuleStatus }> {
  if (!config.groq.apiKey) {
    return { result: keywordFallback(transcript), status: 'partial' };
  }
  try {
    const chunks = chunkTranscript(transcript);
    if (chunks.length === 1) {
      const single = await summarizeChunk(chunks[0], language);
      return { result: single, status: 'ok' };
    }
    const parts: SummaryStructured[] = [];
    for (const c of chunks) {
      try { parts.push(await summarizeChunk(c, language)); }
      catch (err) { console.warn(`[ai] chunk failed: ${(err as Error).message}`); }
    }
    if (parts.length === 0) throw new Error('all chunks failed');
    const merged = await mergeSummaries(parts, language).catch(() => null);
    if (merged) return { result: merged, status: parts.length === chunks.length ? 'ok' : 'partial' };
    return {
      result: {
        summary: parts.map(p => p.summary).filter(Boolean).join('\n\n'),
        detailed_rewrite: parts.map(p => p.detailed_rewrite).filter(Boolean).join('\n\n'),
        key_insights: parts.flatMap(p => p.key_insights || []),
        important_points: parts.flatMap(p => p.important_points || []),
        meeting_objective: parts.map(p => p.meeting_objective).filter(Boolean)[0] || '',
        discussion_points: parts.flatMap(p => p.discussion_points || []),
        decisions: parts.flatMap(p => p.decisions || []),
        risks_blockers: parts.flatMap(p => p.risks_blockers || []),
        follow_ups: parts.flatMap(p => p.follow_ups || []),
        next_meeting: parts.map(p => p.next_meeting).filter(Boolean)[0] || null,
        outcome: parts.map(p => p.outcome).filter(Boolean).slice(-1)[0] || '',
      },
      status: 'partial',
    };
  } catch (err) {
    console.warn(`[ai] summary primary failed: ${(err as Error).message} — falling back to single-shot`);
  }
  try {
    const trimmed = condenseToBudget(transcript, MAX_TRANSCRIPT_CHARS_PER_CALL);
    return { result: await summarizeChunk(trimmed, language), status: 'partial' };
  } catch (err) {
    console.warn(`[ai] summary fallback failed: ${(err as Error).message} — keyword extraction`);
  }
  return { result: keywordFallback(transcript), status: 'partial' };
}

// ─── Module: action items ────────────────────────────────────────────────────

interface ActionItemRaw { task?: string; owner?: string | null; due?: string | null }

async function runActionItemsModule(
  transcript: string,
  language: string | null,
): Promise<{ result: ActionItem[]; status: ModuleStatus }> {
  if (!config.groq.apiKey) return { result: [], status: 'skipped' };
  const slice = condenseToBudget(transcript, MAX_TRANSCRIPT_CHARS_PER_CALL);
  try {
    const parsed = await groqJSON<{ action_items?: ActionItemRaw[] }>(
      'action-items',
      `Extract every actionable commitment from this meeting transcript. For each, identify the task, the owner (the person responsible — null if not stated), and any due date or time hint (null if none). Include ALL commitments, no matter how small. Do not invent owners. ${langHintFor(language)}

Transcript:
${slice}

Return ONLY JSON:
{"action_items":[{"task":"...","owner":"name or null","due":"deadline hint or null"}]}`,
      { maxTokens: 3000 },
    );
    const items = (parsed.action_items || [])
      .filter(a => a?.task && typeof a.task === 'string' && a.task.trim().length > 0)
      .map(a => ({
        task: a.task!.trim(),
        owner: a.owner && typeof a.owner === 'string' ? a.owner.trim() : null,
        dueHint: a.due && typeof a.due === 'string' ? a.due.trim() : null,
      }));
    return { result: items, status: 'ok' };
  } catch (err) {
    console.warn(`[ai] action-items failed: ${(err as Error).message}`);
    return { result: [], status: 'failed' };
  }
}

// ─── Module: questions & answers ─────────────────────────────────────────────

interface QAPairRaw { question?: string; answer?: string | null; asked_by?: string | null }

async function runQuestionsModule(
  transcript: string,
  language: string | null,
): Promise<{ result: QAPair[]; status: ModuleStatus }> {
  if (!config.groq.apiKey) return { result: [], status: 'skipped' };
  const slice = condenseToBudget(transcript, MAX_TRANSCRIPT_CHARS_PER_CALL);
  try {
    const parsed = await groqJSON<{ questions?: QAPairRaw[] }>(
      'questions-answers',
      `Extract the significant questions raised in this meeting. For each question, capture the answer that was given (paraphrased, faithful to the transcript) — or null if it was left unresolved. Also capture who asked, when identifiable. Include both answered and unanswered questions. ${langHintFor(language)}

Transcript:
${slice}

Return ONLY JSON:
{"questions":[{"question":"...","answer":"the answer given, or null if unresolved","asked_by":"name or null"}]}`,
      { maxTokens: 3000 },
    );
    const items = (parsed.questions || [])
      .filter(q => q?.question && typeof q.question === 'string' && q.question.trim().length > 0)
      .map(q => ({
        question: q.question!.trim(),
        answer: q.answer && typeof q.answer === 'string' && q.answer.trim() ? q.answer.trim() : null,
        askedBy: q.asked_by && typeof q.asked_by === 'string' ? q.asked_by.trim() : null,
      }));
    return { result: items, status: 'ok' };
  } catch (err) {
    console.warn(`[ai] questions-answers failed: ${(err as Error).message}`);
    return { result: [], status: 'failed' };
  }
}

// ─── Module: chapters ────────────────────────────────────────────────────────

interface ChapterRaw { title?: string; start_ms?: number; end_ms?: number; summary?: string }

async function runChaptersModule(
  segments: PipelineSegment[],
  language: string | null,
): Promise<{ result: Chapter[]; status: ModuleStatus }> {
  if (!config.groq.apiKey || segments.length < 6) return { result: [], status: 'skipped' };
  const timed = condenseToBudget(
    segments
      .map(s => `[${formatTime(s.startMs)}|${s.startMs}] ${s.speakerName || s.speakerLabel || '?'}: ${s.text}`)
      .join('\n'),
    MAX_TRANSCRIPT_CHARS_PER_CALL,
  );
  try {
    const parsed = await groqJSON<{ chapters?: ChapterRaw[] }>(
      'chapters',
      `Divide this meeting into topic-coherent chapters. Each line begins with [mm:ss|<startMs>] timestamp. Use the startMs values directly. Return as many chapters as the content needs — minimum 2, no upper limit. Do not invent timestamps outside the range. ${langHintFor(language)}

Transcript:
${timed}

Return ONLY JSON:
{"chapters":[{"title":"...","start_ms":<number>,"end_ms":<number>,"summary":"one-line topic summary"}]}`,
      { maxTokens: 3000 },
    );
    const items = (parsed.chapters || [])
      .filter(c => c?.title && typeof c.start_ms === 'number' && typeof c.end_ms === 'number')
      .map(c => ({
        title: String(c.title).trim(),
        startMs: c.start_ms!,
        endMs: c.end_ms!,
        summary: String(c.summary ?? '').trim(),
      }))
      .sort((a, b) => a.startMs - b.startMs);
    return { result: items, status: items.length > 0 ? 'ok' : 'failed' };
  } catch (err) {
    console.warn(`[ai] chapters failed: ${(err as Error).message}`);
    return { result: [], status: 'failed' };
  }
}

// ─── Module: speaker insights ────────────────────────────────────────────────

interface SpeakerInsightRaw {
  name?: string;
  contributions?: string[];
  ownership?: string[];
  collaboration?: string[];
}

async function runSpeakerInsightsModule(
  segments: PipelineSegment[],
  language: string | null,
): Promise<{ result: SpeakerInsight[]; status: ModuleStatus }> {
  const speakers = uniqueSpeakers(segments);
  if (!config.groq.apiKey || speakers.length === 0) return { result: [], status: 'skipped' };

  const transcript = condenseToBudget(transcriptToText(segments), MAX_TRANSCRIPT_CHARS_PER_CALL);
  const speakerList = speakers.join(', ');

  try {
    const parsed = await groqJSON<{ speakers?: SpeakerInsightRaw[] }>(
      'speaker-insights',
      `Analyze each speaker's role in this meeting. For each speaker, list:
  - contributions: initiatives proposed, decisions advocated, key things they said
  - ownership: tasks they accepted or claimed responsibility for
  - collaboration: other speakers they directly engaged with or referenced

Be specific — quote or paraphrase. Do not invent. Scale each list to what the transcript supports for that speaker. ${langHintFor(language)}

Speakers: ${speakerList}

Transcript:
${transcript}

Return ONLY JSON:
{"speakers":[{"name":"<exact speaker name>","contributions":["..."],"ownership":["..."],"collaboration":["..."]}]}`,
      { maxTokens: 3000 },
    );
    const items = (parsed.speakers || [])
      .filter(s => s?.name && typeof s.name === 'string')
      .map(s => ({
        name: s.name!.trim(),
        contributions: (s.contributions || []).filter(x => typeof x === 'string' && x.trim()),
        ownership: (s.ownership || []).filter(x => typeof x === 'string' && x.trim()),
        collaboration: (s.collaboration || []).filter(x => typeof x === 'string' && x.trim()),
      }));
    return { result: items, status: items.length > 0 ? 'ok' : 'failed' };
  } catch (err) {
    console.warn(`[ai] speaker-insights failed: ${(err as Error).message}`);
    return { result: [], status: 'failed' };
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export async function runPipeline(
  segments: PipelineSegment[],
  _title?: string,
): Promise<PipelineResult> {
  const empty: PipelineResult = {
    language: null,
    summary: '',
    detailedRewrite: '',
    keyInsights: [],
    importantPoints: [],
    actionItems: [],
    keyQuestions: [],
    chapters: [],
    speakerInsights: [],
    meetingObjective: '',
    discussionPoints: [],
    decisions: [],
    risks: [],
    followUps: [],
    nextMeeting: null,
    outcome: '',
    qaPairs: [],
    status: {},
  };

  if (!segments || segments.length === 0) return empty;
  const transcript = transcriptToText(segments);
  if (transcript.trim().length < MIN_TRANSCRIPT_CHARS) {
    return { ...empty, summary: 'Meeting too short to analyze.', status: { summary: 'skipped' } };
  }

  const language = await detectLanguage(transcript);

  // Run sequentially — Groq free tier is 6000 TPM and parallel calls burst past it.
  // A small inter-module pause lets the TPM bucket drain.
  const PAUSE_MS = 1500;
  const summary   = await runSummaryModule(transcript, language);
  await sleep(PAUSE_MS);
  const actions   = await runActionItemsModule(transcript, language);
  await sleep(PAUSE_MS);
  const questions = await runQuestionsModule(transcript, language);
  await sleep(PAUSE_MS);
  const chapters  = await runChaptersModule(segments, language);
  await sleep(PAUSE_MS);
  const speakers  = await runSpeakerInsightsModule(segments, language);

  const strList = (xs?: (string | null | undefined)[]) =>
    (xs || []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim());

  const sumPayload = summary.result;
  return {
    language,
    summary: (sumPayload.summary || '').trim(),
    detailedRewrite: (sumPayload.detailed_rewrite || '').trim(),
    keyInsights: strList(sumPayload.key_insights),
    importantPoints: strList(sumPayload.important_points),
    actionItems: actions.result,
    // Backwards-compatible: keyQuestions remains the list of OPEN questions.
    keyQuestions: questions.result.filter(q => !q.answer).map(q => q.question),
    chapters: chapters.result,
    speakerInsights: speakers.result,
    meetingObjective: (sumPayload.meeting_objective || '').trim(),
    discussionPoints: strList(sumPayload.discussion_points),
    decisions: strList(sumPayload.decisions),
    risks: strList(sumPayload.risks_blockers),
    followUps: strList(sumPayload.follow_ups),
    nextMeeting: (typeof sumPayload.next_meeting === 'string' && sumPayload.next_meeting.trim()
      && !/^(null|none|n\/a)$/i.test(sumPayload.next_meeting.trim()))
      ? sumPayload.next_meeting.trim() : null,
    outcome: (sumPayload.outcome || '').trim(),
    qaPairs: questions.result,
    status: {
      language: language ? 'ok' : 'failed',
      summary: summary.status,
      actionItems: actions.status,
      insights: summary.status,
      questions: questions.status,
      chapters: chapters.status,
      speakers: speakers.status,
    },
  };
}
