/**
 * Run once to save a Zoom session to ~/.noteai/zoom-bot-profile
 * Usage: npx tsx scripts/zoom-login.ts
 *
 * Steps:
 *  1. Chrome opens at zoom.us/signin
 *  2. Sign in to your Zoom account manually
 *  3. Press Ctrl+C to save the session and exit
 */
import { chromium } from 'playwright'
import path from 'path'
import os from 'os'

const profileDir = process.env.BOT_ZOOM_CHROME_PROFILE_DIR ||
  path.join(os.homedir(), '.noteai', 'zoom-bot-profile')

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--disable-infobars',
  '--window-size=1280,800',
  '--disable-blink-features=AutomationControlled',
]

async function main() {
  console.log(`[zoom-login] Profile directory: ${profileDir}`)
  console.log('[zoom-login] Opening Chrome — sign in to your Zoom account, then press Ctrl+C.\n')

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    args: CHROME_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  })

  const page = await context.newPage()
  await page.goto('https://zoom.us/signin', { waitUntil: 'domcontentloaded' })

  console.log('[zoom-login] Browser is open. Complete sign-in and then press Ctrl+C to save.')

  await new Promise<void>(resolve => {
    process.on('SIGINT', () => resolve())
    process.on('SIGTERM', () => resolve())
  })

  await context.close()
  console.log(`\n[zoom-login] Session saved to: ${profileDir}`)
  console.log('[zoom-login] Done — the Zoom bot will use this session for all future meetings.')
}

main().catch(err => {
  console.error('[zoom-login] Error:', err)
  process.exit(1)
})