import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { config } from '../config'

export interface ZoomBotOptions {
  meetingUrl: string
  displayName?: string
  onAudioChunk?: (chunk: Buffer) => void
  onTrackAudio?: (chunk: Buffer, trackId: string) => void
  onTrackInfo?: (trackId: string, name: string) => void
  onSpeakerEvent?: (event: Record<string, unknown>) => void
  onJoined?: () => void
  onEnded?: () => void
  onError?: (err: Error) => void
}

const CHROME_ARGS = [
  '--no-sandbox',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-gpu',
  '--no-first-run',
  '--mute-audio',
  '--disable-infobars',
  '--disable-default-apps',
  '--window-size=1280,800',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--no-default-browser-check',
  '--disable-extensions-except=',
]

export class ZoomBot {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ended = false
  private persistentContext = false
  private blockReason: string | null = null

  async start(opts: ZoomBotOptions): Promise<void> {
    const { meetingUrl, displayName = 'NoteAI Recorder' } = opts

    const webClientUrl = toZoomWebClientUrl(meetingUrl)

    const defaultProfile = path.join(os.homedir(), '.noteai', 'zoom-bot-profile')
    const candidate = config.botZoomChromeProfileDir || defaultProfile
    const hasProfile = fs.existsSync(path.join(candidate, 'Default'))
    const profileDir = hasProfile ? candidate : ''

    if (profileDir) {
      console.log(`[zoom-bot] Using saved Chrome profile: ${profileDir}`)
      this.context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: false,
        args: CHROME_ARGS,
        permissions: ['microphone', 'camera'],
        ignoreDefaultArgs: ['--enable-automation'],
      })
      this.persistentContext = true
    } else {
      console.log('[zoom-bot] No Chrome profile found — joining as guest')
      console.log('[zoom-bot] Run `npx tsx scripts/zoom-login.ts` once to fix this.')
      this.browser = await chromium.launch({
        channel: 'chrome',
        headless: false,
        args: CHROME_ARGS,
        ignoreDefaultArgs: ['--enable-automation'],
      })
      this.context = await this.browser.newContext({
        permissions: ['microphone', 'camera'],
      })
    }

    if (this.persistentContext && this.context) {
      for (const p of this.context.pages()) {
        try { await p.close() } catch {}
      }
    }

    this.page = await this.context.newPage()

    // tsx/esbuild wraps named functions with a __name() helper. When Playwright
    // serializes our inline page functions into the page, that helper is missing
    // and throws "ReferenceError: __name is not defined" — which also breaks
    // Zoom's reCAPTCHA. Define a no-op so injected functions resolve.
    await this.context.addInitScript(() => {
      const g = globalThis as unknown as { __name?: (fn: unknown) => unknown }
      if (typeof g.__name === 'undefined') g.__name = (fn) => fn
    })

    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol
    })

    this.page.on('crash', () => console.error('[zoom-bot] Page crashed'))
    this.page.on('console', msg => {
      if (msg.text().startsWith('[NoteAI]')) console.log('[zoom-page]', msg.text())
    })

    // Expose on page (main frame) — Zoom creates WebRTC connections in the main frame
    await this.page.exposeFunction('noteAISendTrackAudio', (samples: number[], trackId: string) => {
      if (opts.onTrackAudio) {
        const i16 = new Int16Array(samples)
        opts.onTrackAudio(Buffer.from(i16.buffer), trackId)
      }
    })

    await this.page.exposeFunction('noteAISendTrackInfo', (trackId: string, name: string) => {
      opts.onTrackInfo?.(trackId, name)
    })

    await this.page.exposeFunction('noteAISendEvent', (json: string) => {
      if (opts.onSpeakerEvent) {
        try { opts.onSpeakerEvent(JSON.parse(json)) } catch {}
      }
    })

    await this.page.addInitScript({
      path: path.resolve(__dirname, 'zoomAudioInjector.js'),
    })

    console.log(`[zoom-bot] Navigating to ${webClientUrl}`)
    await this.page.goto(webClientUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await this.page.waitForTimeout(3000)

    console.log('[zoom-bot] Starting pre-join flow')
    await this.handlePreJoin(displayName)

    if (this.ended) {
      const msg = this.blockReason
        ? `Zoom bot blocked: ${this.blockReason}`
        : 'Zoom bot was blocked from joining (no meeting UI after 5 min)'
      console.error(`[zoom-bot] Join failed: ${msg}`)
      opts.onError?.(new Error(msg))
      await this.stop()
      return
    }

    opts.onJoined?.()
    console.log(`[zoom-bot] Joined Zoom meeting as "${displayName}"`)

    await this.tryOpenParticipantsPanel()
    this.pollParticipantNames(opts)
    this.watchForAlone(opts.onEnded)
    this.watchForEnd(opts.onEnded, opts.onError)
  }

  async stop(): Promise<void> {
    const page = this.page
    const context = this.context
    const browser = this.browser
    const wasPersistent = this.persistentContext

    if (!page && !context && !browser) return

    this.ended = true
    this.page = null
    this.context = null
    this.browser = null

    if (page) {
      try {
        for (const sel of [
          'button[aria-label="Leave"]',
          '.footer__leave-btn',
          'button:has-text("Leave")',
        ]) {
          const btn = await page.$(sel)
          if (btn) {
            await btn.click()
            await page.waitForTimeout(800)
            // Confirm dialog if it appears
            for (const confirmSel of [
              'button:has-text("Leave Meeting")',
              'button.leave-meeting-options__btn',
            ]) {
              const confirmBtn = await page.$(confirmSel)
              if (confirmBtn) { await confirmBtn.click(); break }
            }
            break
          }
        }
      } catch {}
    }

    try {
      if (wasPersistent) {
        await context?.close()
      } else {
        await browser?.close()
      }
    } catch {}

    console.log('[zoom-bot] Browser closed')
  }

  // ── Pre-join ──────────────────────────────────────────────────────────────

  private async handlePreJoin(displayName: string): Promise<void> {
    const page = this.page!
    await this.waitForPreJoinUI(page)
    await this.trySetName(page, displayName)
    await this.tryMuteAudio(page)
    await this.tryDisableVideo(page)
    await this.tryClickJoin(page)
    await this.waitForMeetingUI(page)
    await this.tryJoinAudio(page)
  }

  private async waitForPreJoinUI(page: Page): Promise<void> {
    const signals = [
      ...NAME_INPUT_SELECTORS,
      'button.preview-join-button',
      'button:has-text("Join")',
      '[class*="preview-join"]',
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return

      if (await this.hasInMeetingSignal(page)) {
        console.log('[zoom-bot] Already in meeting — skipping pre-join wait')
        return
      }

      for (const sel of signals) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible()) {
            console.log(`[zoom-bot] Pre-join UI ready via "${sel}" (+${Math.round((Date.now() - startMs) / 1000)}s)`)
            return
          }
        } catch {}
      }

      const elapsed = Math.round((Date.now() - startMs) / 1000)
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`[zoom-bot] Waiting for pre-join UI (${elapsed}s)...`)
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[zoom-bot] Pre-join UI not detected after 30s — proceeding anyway')
  }

  private async trySetName(page: Page, name: string): Promise<void> {
    // Wait briefly for the name field to render — the new app.zoom.us client
    // mounts it asynchronously after the page settles.
    const start = Date.now()
    while (Date.now() - start < 15_000) {
      if (this.ended) return
      for (const sel of NAME_INPUT_SELECTORS) {
        try {
          const el = await page.$(sel)
          if (!el || !(await el.isVisible()) || !(await el.isEnabled())) continue

          // Clear any default, then type with real key events. fill() alone does
          // not always flip React's internal state, leaving the Join button
          // disabled; pressSequentially fires keydown/input/keyup per character.
          await el.click({ clickCount: 3 })
          await el.press('Backspace').catch(() => {})
          // type() fires keydown/input/keyup per character so React's controlled
          // input updates and the Join button enables.
          await el.type(name, { delay: 25 })

          const actual = await el.inputValue()
          if (actual === name) {
            console.log(`[zoom-bot] Display name set: "${name}" (via ${sel})`)
            return
          }
          // Fallback: fill + dispatch events if typing didn't take
          await el.fill(name)
          if ((await el.inputValue()) === name) {
            console.log(`[zoom-bot] Display name set via fill: "${name}" (${sel})`)
            return
          }
          console.warn(`[zoom-bot] Name mismatch — expected "${name}", got "${actual}"`)
        } catch {}
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[zoom-bot] Name field not found after 15s — joining without setting display name')
  }

  private async tryMuteAudio(page: Page): Promise<void> {
    // These selectors only match the mic when it is currently UNMUTED (i.e. the
    // button's action is "Mute"). If the bot is already muted (button reads
    // "Unmute"), none match and we leave it off — exactly what we want.
    const selectors = [
      'button[aria-label="Mute"]',
      'button[aria-label*="mute my microphone" i]',
      'button[aria-label*="mute microphone" i]',
      '.preview-audio-control__btn--unmuted',
      '[class*="audio-option"] button[class*="active"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) {
          await el.click()
          console.log(`[zoom-bot] Microphone muted (via ${sel})`)
          return
        }
      } catch {}
    }
    console.log('[zoom-bot] Mic already muted or toggle not found — leaving mic off')
  }

  private async tryDisableVideo(page: Page): Promise<void> {
    // Same idempotent logic: only matches when video is currently ON.
    const selectors = [
      'button[aria-label="Stop Video"]',
      'button[aria-label*="stop my video" i]',
      'button[aria-label*="stop video" i]',
      '.preview-video-control__btn--on',
      '[class*="video-option"] button[class*="active"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) {
          await el.click()
          console.log(`[zoom-bot] Camera turned off (via ${sel})`)
          return
        }
      } catch {}
    }
    console.log('[zoom-bot] Camera already off or toggle not found — leaving video off')
  }

  private async tryClickJoin(page: Page): Promise<void> {
    const selectors = [
      'button.preview-join-button',
      'button[aria-label*="join" i]',
      'button:has-text("Join")',
      '[class*="preview-join"]',
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (!el) continue
          if (await el.isVisible() && await el.isEnabled()) {
            await el.click()
            console.log(`[zoom-bot] Clicked join button via "${sel}" (+${Math.round((Date.now() - startMs) / 1000)}s)`)
            return
          }
        } catch {}
      }
      const elapsed = Math.round((Date.now() - startMs) / 1000)
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`[zoom-bot] Waiting for join button (${elapsed}s)...`)
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[zoom-bot] Join button not found after 30s')
  }

  // Zoom requires clicking "Join Audio" after entering the meeting
  private async tryJoinAudio(page: Page): Promise<void> {
    const selectors = [
      'button[aria-label*="join audio" i]',
      'button:has-text("Join Audio")',
      '.join-audio-by-voip__join-btn',
      'button:has-text("Join by Computer Audio")',
      'button[aria-label*="computer audio" i]',
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 10_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible() && await el.isEnabled()) {
            // zoomAudioInjector.js keeps RTCPeerConnection patched on a 500ms
            // interval, so no inline re-patch is needed here.
            await el.click()
            console.log(`[zoom-bot] Clicked join audio via "${sel}"`)
            return
          }
        } catch {}
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.log('[zoom-bot] No join-audio button found — audio may already be active')
  }

  private async hasInMeetingSignal(page: Page): Promise<boolean> {
    for (const sel of IN_MEETING_SIGNALS) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) return true
      } catch {}
    }
    return false
  }

  private async waitForMeetingUI(page: Page): Promise<void> {
    for (let i = 0; i < 300; i++) {
      if (this.ended) return

      if (i >= 5 && await this.checkBlocked(page)) return

      try {
        if (await this.hasInMeetingSignal(page)) {
          console.log('[zoom-bot] Meeting UI detected')
          return
        }
      } catch {}

      if (i > 0 && i % 30 === 0) {
        console.log(`[zoom-bot] Waiting for meeting UI (${i}s) — may be in waiting room`)
      }
      await page.waitForTimeout(1000).catch(() => {})
    }
    console.warn('[zoom-bot] Meeting UI not detected after 5 min')
    this.ended = true
  }

  private async checkBlocked(page: Page): Promise<boolean> {
    try {
      const reason = await page.evaluate(() => {
        const text = (document.body.innerText || '').slice(0, 4000)
        const blocked =
          /this meeting has been ended/i.test(text) ||
          /invalid meeting id/i.test(text) ||
          /this meeting is for authorized attendees only/i.test(text) ||
          /meeting is locked/i.test(text) ||
          /you have been removed/i.test(text)
        if (!blocked) return null
        const m = text.match(/(this meeting[^.]+\.?|invalid meeting[^.]+\.?|you have been[^.]+\.?)/i)
        return m?.[0] || 'Blocked from joining Zoom meeting'
      })
      if (reason) {
        console.warn(`[zoom-bot] Blocked: ${reason}`)
        this.blockReason = reason
        this.ended = true
        return true
      }
    } catch {}
    return false
  }

  // ── Participant name polling ───────────────────────────────────────────────

  // Opening the participants panel keeps a stable, named list in the DOM and
  // exposes per-participant speaking indicators, which makes active-speaker
  // detection far more reliable than scraping video tiles alone.
  private async tryOpenParticipantsPanel(): Promise<void> {
    const page = this.page!
    const selectors = [
      'button[aria-label*="open the participants" i]',
      'button[aria-label*="participants" i]',
      '.footer-button__participants-icon',
      '[feature-type="participant"]',
      'button[aria-label*="manage participants" i]',
    ]
    for (const sel of selectors) {
      try {
        const btn = await page.$(sel)
        if (btn && await btn.isVisible()) {
          await btn.click()
          console.log('[zoom-bot] Opened participants panel via', sel)
          return
        }
      } catch {}
    }
    console.log('[zoom-bot] Could not open participants panel — using tile scraping')
  }

  // Scrape the visible participant names from the Zoom DOM, excluding the bot
  // itself and non-name UI strings. Shared by name-polling and alone-detection.
  private async scrapeParticipantNames(page: Page): Promise<string[]> {
    const names = await page.evaluate(() => {
      const selectors = [
        '.participants-item__display-name',
        '[class*="participant-name"]',
        '[class*="display-name"]',
        '.video-avatar__avatar-name',
        '.video-avatar__avatar',
        '[class*="avatar-title"]',
        '.speaker-bar__display-name',
      ]
      const found = new Set<string>()
      for (const sel of selectors) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const t = (el.textContent || '').trim()
          if (t.length > 1) found.add(t)
        }
      }
      return [...found]
    })

    return deduplicateZoomNames(
      names.filter(n =>
        !/^note/i.test(n) && !/recorder/i.test(n) &&
        !NAME_STOPWORDS.has(n.toLowerCase()) &&
        n.length >= 2 && n.length <= 50
      )
    )
  }

  private pollParticipantNames(opts: ZoomBotOptions): void {
    const page = this.page!

    const interval = setInterval(async () => {
      if (this.ended) { clearInterval(interval); return }
      try {
        const cleaned = await this.scrapeParticipantNames(page)
        if (cleaned.length) {
          console.log('[zoom-bot] Participants:', cleaned.join(', '))
          // Feed the correlator: registerParticipant enables solo auto-assign,
          // and names anchor the DOM speaker_start/end → name mapping.
          for (const name of cleaned) {
            opts.onSpeakerEvent?.({ type: 'participant_known', name })
          }
        }
      } catch {}
    }, 5000)
  }

  // ── Alone detection ───────────────────────────────────────────────────────

  private watchForAlone(onEnded?: () => void): void {
    const page = this.page!
    const ALONE_MS = 2 * 60 * 1000
    const CHECK_MS = 30_000
    const GRACE_MS = 60_000
    let aloneAt: number | null = null
    const joinedAt = Date.now()

    const iv = setInterval(async () => {
      if (this.ended) { clearInterval(iv); return }
      if (Date.now() - joinedAt < GRACE_MS) return
      try {
        // Count real OTHER participants (the bot itself is filtered out). Only
        // an empty meeting (0 others) counts as alone — a single remote person
        // means the bot should stay.
        const others = (await this.scrapeParticipantNames(page)).length
        if (others === 0) {
          if (!aloneAt) { aloneAt = Date.now(); console.log('[zoom-bot] Alone — will leave in 2 min') }
          else if (Date.now() - aloneAt >= ALONE_MS) {
            console.log('[zoom-bot] Alone 2 min — leaving'); clearInterval(iv)
            if (!this.ended) { this.ended = true; onEnded?.(); await this.stop() }
          }
        } else {
          if (aloneAt) console.log(`[zoom-bot] Participants rejoined (${others})`)
          aloneAt = null
        }
      } catch {}
    }, CHECK_MS)
  }

  // ── End detection ─────────────────────────────────────────────────────────

  private watchForEnd(onEnded?: () => void, onError?: (err: Error) => void): void {
    const page = this.page!

    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        const url = frame.url()
        if (!url.includes('zoom.us') && !url.includes('zoomgov.com')) {
          if (!this.ended) {
            this.ended = true
            console.log('[zoom-bot] Meeting ended (navigated away from zoom.us)')
            onEnded?.(); this.stop()
          }
        }
      }
    })

    const iv = setInterval(async () => {
      if (this.ended) { clearInterval(iv); return }
      try {
        const ended = await page.evaluate(() => {
          const text = (document.body.innerText || '').slice(0, 2000)
          return /this meeting has been ended/i.test(text) ||
                 /the host has ended the meeting/i.test(text) ||
                 /you have been removed/i.test(text)
        })
        if (ended) {
          this.ended = true; clearInterval(iv)
          console.log('[zoom-bot] Meeting ended (UI signal)')
          onEnded?.(); await this.stop()
          return
        }
        if (await this.checkBlocked(page)) {
          clearInterval(iv)
          onError?.(new Error(this.blockReason || 'Blocked from Zoom meeting'))
          await this.stop()
        }
      } catch {}
    }, 3000)
  }
}

// Only elements that exist INSIDE a joined meeting — never on the pre-join screen.
// The pre-join preview also has mute/camera buttons, so those must NOT appear here
// or the bot falsely concludes it has already joined.
// UI words that get scraped from Zoom's DOM but are never participant names.
const NAME_STOPWORDS = new Set([
  'you', 'me', 'not', 'host', 'guest', 'connecting', 'reconnecting',
  'participants', 'waiting', 'unmute', 'mute',
])

// Name field selectors, ordered newest-client-first. #input-for-name is the
// modern app.zoom.us/wc client; #inputname is the legacy zoom.us/wc client.
const NAME_INPUT_SELECTORS = [
  '#input-for-name',
  'input#inputname',
  'input[aria-label*="your name" i]',
  'input[aria-label*="display name" i]',
  'input[placeholder*="name" i]',
  '.preview-join-username input',
]

const IN_MEETING_SIGNALS = [
  'button[aria-label="Leave"]',
  'button[aria-label*="leave meeting" i]',
  '.footer__leave-btn',
  '#foot-bar',
  '.footer-button-base__button[aria-label*="participants" i]',
  'button[aria-label*="open the participants" i]',
]

// Zoom's DOM often has a container whose textContent = child name repeated twice
// e.g. element contains "khabmu" and its parent reads "khabmukhabmu"
function deduplicateZoomNames(names: string[]): string[] {
  return names.filter(n => {
    // Remove if it's just another name in the list doubled: "khabmu" + "khabmu"
    if (names.some(other => other.length < n.length && n === other + other)) return false
    // Remove self-repeat: "nono" where first half === second half
    if (n.length >= 4 && n.length % 2 === 0 && n.slice(0, n.length / 2) === n.slice(n.length / 2)) return false
    return true
  })
}

export function toZoomWebClientUrl(url: string): string {
  // Normalize any Zoom join link to the modern web client:
  //   zoom.us/j/<id>            → app.zoom.us/wc/<id>/join
  //   zoom.us/wc/join/<id>      → app.zoom.us/wc/<id>/join
  //   app.zoom.us/wc/<id>/join  → unchanged (pwd preserved)
  // Navigating straight to app.zoom.us avoids the redirect that previously
  // raced the pre-join detection.
  const idMatch =
    url.match(/\/(?:j|wc\/join)\/(\d+)/) || url.match(/\/wc\/(\d+)\/join/)
  if (!idMatch) return url

  const meetingId = idMatch[1]
  const pwdMatch = url.match(/[?&]pwd=([^&]+)/)
  const pwd = pwdMatch ? `?pwd=${pwdMatch[1]}` : ''
  return `https://app.zoom.us/wc/${meetingId}/join${pwd}`
}
