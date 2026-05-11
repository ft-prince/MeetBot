/**
 * Run this ONCE to sign the bot into Google manually.
 * After sign-in the session is saved to ~/.noteai/bot-profile
 * and the bot will never need to log in again.
 *
 * Usage:  npx tsx bot-login.ts
 */
import { chromium } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'

const PROFILE_DIR = process.env.BOT_CHROME_PROFILE_DIR ||
  path.join(os.homedir(), '.noteai', 'bot-profile')

fs.mkdirSync(PROFILE_DIR, { recursive: true })
console.log(`\n[login] Profile dir: ${PROFILE_DIR}`)
console.log('[login] Opening browser — sign in to Google, then close the window.\n')

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--window-size=1100,750',
    ],
  })

  const page = await context.newPage()
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded' })

  console.log('[login] Browser is open. Sign in to Google, then come back here.')
  console.log('[login] Waiting for you to close the browser window...\n')

  // Wait until the browser is closed by the user
  await context.waitForEvent('close').catch(() => {})

  console.log('[login] Browser closed. Session saved to:', PROFILE_DIR)
  console.log('[login] You can now start the bot normally — it will stay signed in.\n')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
