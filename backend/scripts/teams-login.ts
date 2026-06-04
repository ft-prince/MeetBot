/**
 * Run once to save a Microsoft Teams session to ~/.noteai/teams-bot-profile
 * Usage: npx tsx scripts/teams-login.ts
 *
 * Steps:
 *  1. Chrome opens at teams.microsoft.com
 *  2. Sign in to your Microsoft account manually
 *  3. Press Ctrl+C to save the session and exit
 *
 * Guest join works without this for meetings that allow anonymous join — only
 * run this if the bot needs to enter org-restricted Teams meetings.
 */
import { chromium } from 'playwright'
import path from 'path'
import os from 'os'

const profileDir = process.env.BOT_TEAMS_CHROME_PROFILE_DIR ||
  path.join(os.homedir(), '.noteai', 'teams-bot-profile')

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--disable-infobars',
  '--window-size=1280,800',
  '--disable-blink-features=AutomationControlled',
]

async function main() {
  console.log(`[teams-login] Profile directory: ${profileDir}`)
  console.log('[teams-login] Opening Chrome — sign in to your Microsoft account, then press Ctrl+C.\n')

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    args: CHROME_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  })

  const page = await context.newPage()
  await page.goto('https://teams.microsoft.com/', { waitUntil: 'domcontentloaded' })

  console.log('[teams-login] Browser is open. Complete sign-in and then press Ctrl+C to save.')

  await new Promise<void>(resolve => {
    process.on('SIGINT', () => resolve())
    process.on('SIGTERM', () => resolve())
  })

  await context.close()
  console.log(`\n[teams-login] Session saved to: ${profileDir}`)
  console.log('[teams-login] Done — the Teams bot will use this session for all future meetings.')
}

main().catch(err => {
  console.error('[teams-login] Error:', err)
  process.exit(1)
})
