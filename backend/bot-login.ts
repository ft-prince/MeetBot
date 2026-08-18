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

  const page = context.pages()[0] || await context.newPage()
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded' })

  console.log('[login] Sign in to Google in the Chrome window that just opened.')
  console.log('[login] When you see your Google account home page, either close the')
  console.log('[login] Chrome window OR press ENTER here — the session is saved live.\n')

  // Block until the user is genuinely done. The previous version awaited a
  // context 'close' event that could resolve (or reject-and-be-swallowed)
  // immediately, after which process.exit(0) tore Chrome down before sign-in —
  // the window "closing by itself". Now we wait on REAL signals only:
  //   • the browser disconnecting (user closed the window), or
  //   • the user pressing ENTER in this terminal.
  // The persistent profile is flushed to disk continuously, so either path
  // leaves a valid signed-in session.
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; resolve() } }

    context.browser()?.on('disconnected', finish)
    context.on('close', finish)

    // Keypress fallback so the window can never self-close before you're ready.
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true)
      process.stdin.resume()
      process.stdin.once('data', finish)
    }
  })

  console.log('\n[login] Saving session…')
  try { await context.close() } catch {}

  console.log('[login] Done! Session saved to:', PROFILE_DIR)
  console.log('[login] Restart the backend — the bot will stay signed in from now on.\n')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
