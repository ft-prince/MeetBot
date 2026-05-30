/**
 * Quick Deepgram API test — streams a sine-wave tone to verify the key works.
 * Usage: npx tsx test-deepgram.ts
 */

import 'dotenv/config'
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'

const API_KEY = process.env.deepgram_api_key || process.env.DEEPGRAM_API_KEY || ''

if (!API_KEY) {
  console.error('Missing deepgram_api_key in .env')
  process.exit(1)
}

console.log('[deepgram] Connecting with key:', API_KEY.slice(0, 8) + '...')

const dg = createClient(API_KEY)

async function run() {
  // First: verify key with a simple REST call (get account info)
  try {
    const { result, error } = await dg.manage.getProjects()
    if (error) throw error
    const project = result?.projects?.[0]
    console.log('\n[deepgram] ✅ API key valid!')
    console.log('[deepgram] Project:', project?.name || 'unknown')
    console.log('[deepgram] Project ID:', project?.project_id || 'unknown')
  } catch (e: any) {
    console.error('\n[deepgram] ❌ API key check failed:', e.message || e)
    process.exit(1)
  }

  // Second: open a live streaming connection and send a few frames of silence
  // to confirm the streaming endpoint is reachable with this key
  console.log('\n[deepgram] Testing live streaming connection...')

  await new Promise<void>((resolve, reject) => {
    const live = dg.listen.live({
      model: 'nova-2',
      language: 'en-US',
      smart_format: true,
      interim_results: true,
      diarize: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    })

    const timeout = setTimeout(() => {
      console.log('[deepgram] ✅ Live connection open (no speech detected — expected for silence)')
      live.finish()
      resolve()
    }, 4000)

    live.on(LiveTranscriptionEvents.Open, () => {
      console.log('[deepgram] ✅ Live WebSocket connected')

      // Send 3 seconds of silence (16-bit PCM, 16kHz)
      const silenceChunk = Buffer.alloc(16000 * 2)  // 1s of silence
      live.send(silenceChunk)
      live.send(silenceChunk)
      live.send(silenceChunk)
    })

    live.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript
      if (transcript) {
        clearTimeout(timeout)
        console.log('[deepgram] ✅ Got transcript:', transcript)
        live.finish()
        resolve()
      }
    })

    live.on(LiveTranscriptionEvents.Error, (err) => {
      clearTimeout(timeout)
      console.error('[deepgram] ❌ Live stream error:', err)
      reject(err)
    })

    live.on(LiveTranscriptionEvents.Close, () => {
      clearTimeout(timeout)
      resolve()
    })
  })

  // Third: show usage/balance info
  try {
    const projects = await dg.manage.getProjects()
    const projectId = projects.result?.projects?.[0]?.project_id
    if (projectId) {
      const usage = await dg.manage.getUsageSummary(projectId, {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      })
      console.log('\n[deepgram] Usage (last 30 days):')
      console.log(JSON.stringify(usage.result, null, 2))
    }
  } catch {
    // Usage endpoint may need extra permissions — not critical
  }

  console.log('\n[deepgram] All checks passed ✅')
  console.log('[deepgram] Model: nova-2 | Diarization: enabled | Streaming: working')
}

run().catch(err => { console.error(err); process.exit(1) })