import 'dotenv/config'
import { getMeetingTranscript, saveSummary } from './src/services/meetingService'
import { generateSummary } from './src/services/summaryService'

const meetingId = process.argv[2] || '672c02c3-b513-4029-91e3-2f89686b88f5'

async function main() {
  const segments = await getMeetingTranscript(meetingId)
  console.log(`[regen] ${segments.length} segments found`)

  const result = await generateSummary(
    segments.map((s: any) => ({
      speakerName: s.speaker_name,
      speakerLabel: s.speaker_label,
      text: s.text,
      startMs: s.start_ms,
    })),
    meetingId
  )

  if (!result.summary) {
    console.error('[regen] No summary generated — check Groq API key / errors above')
    process.exit(1)
  }

  await saveSummary(meetingId, result.summary, result.keyInsights, result.detailedRewrite, result.importantPoints)
  console.log('[regen] ✅ Saved!')
  console.log('\nSummary:', result.summary)
  console.log('\nInsights:', result.keyInsights)
  console.log('\nPoints:', result.importantPoints)
}

main().catch(err => { console.error(err); process.exit(1) })
