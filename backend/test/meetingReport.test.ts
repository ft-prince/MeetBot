import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../src/config'
import { runPipeline, type PipelineSegment } from '../src/services/aiPipelineService'
import { generateMeetingPdf } from '../src/services/pdfService'
import { isPseudoParticipantName } from '../src/ws/ingestHandler'
import type { MeetingReportData } from '../src/services/meetingService'

// ── Pipeline output shape (offline — no Groq key) ────────────────────────────

function fakeSegments(n: number): PipelineSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    speakerName: i % 2 === 0 ? 'Alice Kumar' : 'Bob Singh',
    speakerLabel: `Speaker ${(i % 2) + 1}`,
    text: `This is spoken sentence number ${i} about the quarterly launch plan and the pending API migration decision.`,
    startMs: i * 4000,
    endMs: i * 4000 + 3500,
  }))
}

test('runPipeline returns the full comprehensive-summary shape even without an API key', async () => {
  const saved = config.groq.apiKey
  config.groq.apiKey = ''
  try {
    const result = await runPipeline(fakeSegments(30))

    // Every new field exists with a sane type — consumers (PDF, email, UI)
    // must never see undefined.
    assert.equal(typeof result.summary, 'string')
    assert.equal(typeof result.meetingObjective, 'string')
    assert.equal(typeof result.outcome, 'string')
    assert.ok(Array.isArray(result.discussionPoints))
    assert.ok(Array.isArray(result.decisions))
    assert.ok(Array.isArray(result.risks))
    assert.ok(Array.isArray(result.followUps))
    assert.ok(Array.isArray(result.qaPairs))
    assert.ok(Array.isArray(result.keyQuestions))
    assert.equal(result.nextMeeting, null)

    // Offline fallback still produces a usable summary and marks modules honestly.
    assert.ok(result.summary.length > 0, 'keyword fallback produces a summary')
    assert.equal(result.status.summary, 'partial')
    assert.equal(result.status.actionItems, 'skipped')
    assert.equal(result.status.questions, 'skipped')
  } finally {
    config.groq.apiKey = saved
  }
})

test('runPipeline handles an empty transcript', async () => {
  const saved = config.groq.apiKey
  config.groq.apiKey = ''
  try {
    const result = await runPipeline([])
    assert.equal(result.summary, '')
    assert.deepEqual(result.qaPairs, [])
    assert.deepEqual(result.decisions, [])
  } finally {
    config.groq.apiKey = saved
  }
})

// ── PDF generation ───────────────────────────────────────────────────────────

function fakeReportData(overrides: Partial<MeetingReportData> = {}): MeetingReportData {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    meetingCode: 'abc-defg-hij',
    title: 'Q3 Launch Planning',
    summary: 'Paragraph one about the meeting.\n\nParagraph two with more detail.',
    keyInsights: ['Ship the beta by August 10'],
    detailedRewrite: 'A detailed narrative of the meeting.',
    importantPoints: ['Budget capped at $40k'],
    actionItems: [
      { task: 'Draft the migration RFC', owner: 'Alice Kumar', dueHint: 'Friday' },
      { task: 'Book the load-test window', owner: null, dueHint: null },
    ],
    keyQuestions: ['Do we need SOC2 sign-off before beta?'],
    chapters: [
      { title: 'Kickoff', startMs: 0, endMs: 300000, summary: 'Intros and agenda.' },
      { title: 'API migration', startMs: 300000, endMs: 900000, summary: 'Cutover plan debated.' },
    ],
    speakerInsights: [
      { name: 'Alice Kumar', contributions: ['Proposed the phased cutover'], ownership: ['RFC draft'], collaboration: ['Bob Singh'] },
    ],
    meetingObjective: 'Align on the Q3 launch scope and owners.',
    discussionPoints: ['Phased vs big-bang migration', 'Beta invite list'],
    decisions: ['Phased migration approved'],
    risks: ['Load-test environment not ready'],
    followUps: ['Revisit pricing next week'],
    nextMeeting: 'Tuesday 10:00 AM',
    outcome: 'Scope agreed; owners assigned.',
    qaPairs: [
      { question: 'When does the beta open?', answer: 'August 10, pending load tests.', askedBy: 'Bob Singh' },
      { question: 'Who owns rollback?', answer: null, askedBy: null },
    ],
    processingStatus: { summary: 'ok' },
    language: 'en',
    startedAt: new Date('2026-07-01T10:00:00Z'),
    endedAt: new Date('2026-07-01T11:00:00Z'),
    durationMs: 3_600_000,
    owner: { email: 'owner@example.com', name: 'Renata' },
    participants: ['Alice Kumar', 'Bob Singh'],
    ...overrides,
  } as MeetingReportData
}

test('generateMeetingPdf produces a valid PDF with all sections', async () => {
  const pdf = await generateMeetingPdf(fakeReportData())
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'starts with the PDF magic bytes')
  assert.ok(pdf.length > 2000, `PDF has substance (${pdf.length} bytes)`)
})

test('generateMeetingPdf tolerates a sparse meeting (no AI output)', async () => {
  const pdf = await generateMeetingPdf(fakeReportData({
    summary: '', meetingObjective: '', outcome: '', detailedRewrite: '',
    discussionPoints: [], decisions: [], risks: [], followUps: [],
    nextMeeting: null, qaPairs: [], actionItems: [], chapters: [],
    speakerInsights: [], keyInsights: [], importantPoints: [], keyQuestions: [],
    participants: [],
  }))
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
})

test('generateMeetingPdf handles a long meeting without throwing (multi-page)', async () => {
  const many = (n: number, s: string) => Array.from({ length: n }, (_, i) => `${s} ${i} — with enough words to wrap across the page width for realism.`)
  const pdf = await generateMeetingPdf(fakeReportData({
    discussionPoints: many(40, 'Discussion point'),
    decisions: many(25, 'Decision'),
    followUps: many(25, 'Follow-up'),
    qaPairs: Array.from({ length: 20 }, (_, i) => ({ question: `Question ${i}?`, answer: i % 3 ? `Answer ${i}` : null, askedBy: null })),
    chapters: Array.from({ length: 15 }, (_, i) => ({ title: `Chapter ${i}`, startMs: i * 60000, endMs: (i + 1) * 60000, summary: 'Topic summary.' })),
  }))
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
  assert.ok(pdf.length > 8000)
})

// ── Pseudo-participant filtering (screen-share hardening) ────────────────────

test('isPseudoParticipantName rejects presentation/screen tiles and accepts humans', () => {
  for (const pseudo of [
    'Prince S (Presentation)', "Alice's screen", 'Screen share', 'Presentation',
    'Bob is presenting', 'shared screen', null, undefined, '',
  ]) {
    assert.equal(isPseudoParticipantName(pseudo as string), true, `should reject: ${pseudo}`)
  }
  for (const human of ['Alice Kumar', 'Bob Singh', 'Renata', 'Screenwright Jones']) {
    assert.equal(isPseudoParticipantName(human), false, `should accept: ${human}`)
  }
})
