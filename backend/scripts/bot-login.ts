/**
 * Run once to save a Google session to ~/.noteai/bot-profile
 * Usage: npx tsx scripts/bot-login.ts
 *
 * Steps:
 *  1. Chrome opens at accounts.google.com
 *  2. Sign in with any Google account (personal or Workspace)
 *  3. Press Ctrl+C to save the session and exit
 *
 * The bot will then use this profile to join Google Meet meetings
 * as a signed-in Google user instead of an anonymous guest.
 */
import { chromium } from 'playwright'
import path from 'path'
import os from 'os'

const profileDir = process.env.BOT_CHROME_PROFILE_DIR ||
  path.join(os.homedir(), '.noteai', 'bot-profile')

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--disable-infobars',
  '--window-size=1280,800',
  '--disable-blink-features=AutomationControlled',
]

async function main() {
  console.log(`[bot-login] Profile directory: ${profileDir}`)
  console.log('[bot-login] Opening Chrome — sign in to your Google account, then press Ctrl+C.\n')

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    args: CHROME_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  })

  const page = await context.newPage()
  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' })

  console.log('[bot-login] Browser is open. Complete Google sign-in, then press Ctrl+C to save.')
  console.log('[bot-login] Tip: use an account that has access to the meetings you want to record.')

  await new Promise<void>(resolve => {
    process.on('SIGINT', () => resolve())
    process.on('SIGTERM', () => resolve())
  })

  await context.close()
  console.log(`\n[bot-login] Session saved to: ${profileDir}`)
  console.log('[bot-login] Done — the Meet bot will use this Google account for all future meetings.')
}

main().catch(err => {
  console.error('[bot-login] Error:', err)
  process.exit(1)
})
