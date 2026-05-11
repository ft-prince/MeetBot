/**
 * Run this ONCE to sign the bot into Google with real Chrome.
 * Session is saved to ~/.noteai/bot-profile permanently.
 *
 * Usage:  npx tsx bot-login.ts
 */
import { chromium } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'

const PROFILE_DIR = process.env.BOT_CHROME_PROFILE_DIR ||
  path.join(os.homedir(), '.noteai', 'bot-profile')

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  console.log(`\n[login] Profile dir: ${PROFILE_DIR}`)
  console.log('[login] Opening REAL Chrome — sign in to Google, then close the window.\n')

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',          // ← real Chrome, not Playwright Chromium
    headless: false,
    args: ['--no-first-run', '--window-size=1100,750'],
  })

  const page = await context.newPage()
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded' })

  console.log('[login] Sign in to Google in the Chrome window that just opened.')
  console.log('[login] Once you see your Google account home page, close the window.\n')

  await context.waitForEvent('close').catch(() => {})

  console.log('[login] Done! Session saved to:', PROFILE_DIR)
  console.log('[login] Restart the backend — the bot will stay signed in from now on.\n')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
