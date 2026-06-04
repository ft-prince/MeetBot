import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { config } from '../config'

export interface TeamsBotOptions {
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

export class TeamsBot {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ended = false
  private persistentContext = false
  private blockReason: string | null = null

  async start(opts: TeamsBotOptions): Promise<void> {
    const { meetingUrl, displayName = 'NoteAI Recorder' } = opts

    const webClientUrl = toTeamsWebClientUrl(meetingUrl)

    const defaultProfile = path.join(os.homedir(), '.noteai', 'teams-bot-profile')
    const candidate = config.botTeamsChromeProfileDir || defaultProfile
    const hasProfile = fs.existsSync(path.join(candidate, 'Default'))
    const profileDir = hasProfile ? candidate : ''

    if (profileDir) {
      // ── Authenticated mode ──────────────────────────────────────────────
      // Pre-signed-in Microsoft session — required for org-restricted meetings.
      // Run `npx tsx scripts/teams-login.ts` once to create the profile.
      console.log(`[teams-bot] Using saved Chrome profile: ${profileDir}`)
      this.context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: false,
        args: CHROME_ARGS,
        permissions: ['microphone', 'camera'],
        ignoreDefaultArgs: ['--enable-automation'],
      })
      this.persistentContext = true
    } else {
      // ── Guest mode ──────────────────────────────────────────────────────
      // No Microsoft account — works only for meetings that allow anonymous join.
      console.log('[teams-bot] No Chrome profile found — joining as guest (may be blocked by org-restricted meetings)')
      console.log('[teams-bot] Run `npx tsx scripts/teams-login.ts` once to fix this.')
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
    // serializes our inline page functions into the page that helper is missing
    // and throws "ReferenceError: __name is not defined". Define a no-op shim.
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

    this.page.on('crash', () => console.error('[teams-bot] Page crashed'))
    this.page.on('console', msg => {
      if (msg.text().startsWith('[NoteAI]')) console.log('[teams-page]', msg.text())
    })

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
      path: path.resolve(__dirname, 'teamsAudioInjector.js'),
    })

    console.log(`[teams-bot] Navigating to ${webClientUrl}`)
    await this.page.goto(webClientUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await this.page.waitForTimeout(3000)

    console.log('[teams-bot] Starting pre-join flow')
    await this.handlePreJoin(displayName)

    if (this.ended) {
      const msg = this.blockReason
        ? `Teams bot blocked: ${this.blockReason}`
        : 'Teams bot was blocked from joining (no meeting UI after 5 min — host never admitted the bot)'
      console.error(`[teams-bot] Join failed: ${msg}`)
      opts.onError?.(new Error(msg))
      await this.stop()
      return
    }

    opts.onJoined?.()
    console.log(`[teams-bot] Joined Teams meeting as "${displayName}"`)

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
        for (const sel of LEAVE_SELECTORS) {
          const btn = await page.$(sel)
          if (btn) {
            await btn.click()
            await page.waitForTimeout(800)
            // Confirm "Leave" if a dropdown/confirm appears
            for (const confirmSel of ['button:has-text("Leave")', '[data-tid="hangup-leave-button"]']) {
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

    console.log('[teams-bot] Browser closed')
  }

  // ── Pre-join ──────────────────────────────────────────────────────────────

  private async handlePreJoin(displayName: string): Promise<void> {
    const page = this.page!
    await this.dismissAppLaunchPrompt(page)
    await this.waitForPreJoinUI(page)
    await this.trySetName(page, displayName)
    await this.tryMuteMic(page)
    await this.tryDisableCamera(page)
    await this.tryClickJoin(page)
    await this.waitForMeetingUI(page)
  }

  // Teams first shows a "Open Microsoft Teams?" / "Continue on this browser"
  // interstitial. Click through to the web client.
  private async dismissAppLaunchPrompt(page: Page): Promise<void> {
    const selectors = [
      'button:has-text("Continue on this browser")',
      'a:has-text("Continue on this browser")',
      '[data-tid="joinOnWeb"]',
      'button:has-text("Join on the web instead")',
    ]
    const startMs = Date.now()
    while (Date.now() - startMs < 12_000) {
      if (this.ended) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible()) {
            await el.click()
            console.log(`[teams-bot] Continued on browser via "${sel}"`)
            await page.waitForTimeout(2000)
            return
          }
        } catch {}
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.log('[teams-bot] No "continue on browser" prompt — may already be on web client')
  }

  private async waitForPreJoinUI(page: Page): Promise<void> {
    const signals = [
      ...NAME_INPUT_SELECTORS,
      ...JOIN_SELECTORS,
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return

      if (await this.hasInMeetingSignal(page)) {
        console.log('[teams-bot] Already in meeting — skipping pre-join wait')
        return
      }

      for (const sel of signals) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible()) {
            console.log(`[teams-bot] Pre-join UI ready via "${sel}" (+${Math.round((Date.now() - startMs) / 1000)}s)`)
            return
          }
        } catch {}
      }

      const elapsed = Math.round((Date.now() - startMs) / 1000)
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`[teams-bot] Waiting for pre-join UI (${elapsed}s)...`)
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[teams-bot] Pre-join UI not detected after 30s — proceeding anyway')
  }

  private async trySetName(page: Page, name: string): Promise<void> {
    // The guest name field mounts asynchronously. Authenticated sessions skip
    // the name field entirely (Teams already knows the account), so a miss here
    // is non-fatal.
    const start = Date.now()
    while (Date.now() - start < 12_000) {
      if (this.ended) return
      for (const sel of NAME_INPUT_SELECTORS) {
        try {
          const el = await page.$(sel)
          if (!el || !(await el.isVisible()) || !(await el.isEnabled())) continue

          await el.click({ clickCount: 3 })
          await el.press('Backspace').catch(() => {})
          // type() fires keydown/input/keyup per character so React's controlled
          // input updates and the Join button enables.
          await el.type(name, { delay: 25 })

          let actual = await el.inputValue()
          if (actual !== name) {
            await el.fill(name)
            actual = await el.inputValue()
          }
          if (actual === name) {
            console.log(`[teams-bot] Display name set: "${name}" (via ${sel})`)
            return
          }
          console.warn(`[teams-bot] Name mismatch — expected "${name}", got "${actual}"`)
        } catch {}
      }
      // Authenticated mode: no name field → bail out quickly once join is ready.
      if (await this.hasJoinButton(page)) {
        console.log('[teams-bot] No name field (authenticated session) — proceeding to join')
        return
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[teams-bot] Name field not found after 12s — joining without setting display name')
  }

  private async tryMuteMic(page: Page): Promise<void> {
    // Only matches when mic is currently ON (toggle reads "Mute"). Idempotent:
    // if already muted, nothing matches and we leave it off.
    const selectors = [
      'button[aria-label="Mute"]',
      'button[aria-label*="mute mic" i]',
      'button[aria-label*="mute microphone" i]',
      '[data-tid="toggle-mute"][aria-pressed="false"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) {
          await el.click()
          console.log(`[teams-bot] Microphone muted (via ${sel})`)
          return
        }
      } catch {}
    }
    console.log('[teams-bot] Mic already muted or toggle not found — leaving mic off')
  }

  private async tryDisableCamera(page: Page): Promise<void> {
    const selectors = [
      'button[aria-label="Turn camera off"]',
      'button[aria-label*="turn camera off" i]',
      '[data-tid="toggle-video"][aria-pressed="true"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) {
          await el.click()
          console.log(`[teams-bot] Camera turned off (via ${sel})`)
          return
        }
      } catch {}
    }
    console.log('[teams-bot] Camera already off or toggle not found — leaving video off')
  }

  private async hasJoinButton(page: Page): Promise<boolean> {
    for (const sel of JOIN_SELECTORS) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible() && await el.isEnabled()) return true
      } catch {}
    }
    return false
  }

  private async tryClickJoin(page: Page): Promise<void> {
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return
      for (const sel of JOIN_SELECTORS) {
        try {
          const el = await page.$(sel)
          if (!el) continue
          if (await el.isVisible() && await el.isEnabled()) {
            await el.click()
            console.log(`[teams-bot] Clicked join button via "${sel}" (+${Math.round((Date.now() - startMs) / 1000)}s)`)
            return
          }
        } catch {}
      }
      const elapsed = Math.round((Date.now() - startMs) / 1000)
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`[teams-bot] Waiting for join button (${elapsed}s)...`)
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[teams-bot] Join button not found after 30s')
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
          console.log('[teams-bot] Meeting UI detected')
          return
        }
      } catch {}

      if (i > 0 && i % 30 === 0) {
        console.log(`[teams-bot] Waiting for meeting UI (${i}s) — may be in lobby, please admit the bot`)
      }
      await page.waitForTimeout(1000).catch(() => {})
    }
    console.warn('[teams-bot] Meeting UI not detected after 5 min')
    this.ended = true
  }

  private async checkBlocked(page: Page): Promise<boolean> {
    try {
      const reason = await page.evaluate(() => {
        const text = (document.body.innerText || '').slice(0, 4000)
        const blocked =
          /this meeting (has|was) (already )?ended/i.test(text) ||
          /you were removed from/i.test(text) ||
          /the meeting (you'?re trying to join|isn'?t available)/i.test(text) ||
          /sorry, you (can'?t|couldn'?t) join/i.test(text) ||
          /your (admin|organization) (doesn'?t allow|has restricted)/i.test(text) ||
          /someone (in the meeting|will let you in).*?denied/i.test(text)
        if (!blocked) return null
        const m = text.match(/(this meeting[^.]+\.?|you were removed[^.]+\.?|sorry, you[^.]+\.?|your (admin|organization)[^.]+\.?)/i)
        return m?.[0] || 'Blocked from joining Teams meeting'
      })
      if (reason) {
        console.warn(`[teams-bot] Blocked: ${reason}`)
        this.blockReason = reason
        this.ended = true
        return true
      }
    } catch {}
    return false
  }

  // ── Participant name polling ───────────────────────────────────────────────

  private async scrapeParticipantNames(page: Page): Promise<string[]> {
    const names = await page.evaluate(() => {
      const selectors = [
        '[data-tid="participantsInCall"] [data-tid="roster-cell-name"]',
        '[data-tid="roster-cell-name"]',
        '[data-tid="roster-participant"] span[title]',
        '[role="treeitem"] span[title]',
        '[class*="roster"] [class*="name"]',
      ]
      const found = new Set<string>()
      for (const sel of selectors) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const t = (el.getAttribute('title') || el.textContent || '').trim()
          if (t.length > 1) found.add(t)
        }
      }
      return [...found]
    })

    return names.filter(n =>
      !/^note/i.test(n) && !/recorder/i.test(n) &&
      !TEAMS_NAME_STOPWORDS.has(n.toLowerCase()) &&
      n.length >= 2 && n.length <= 50
    )
  }

  private pollParticipantNames(opts: TeamsBotOptions): void {
    const page = this.page!

    // Open the roster once so participant names are reliably in the DOM.
    this.tryOpenRoster().catch(() => {})

    const interval = setInterval(async () => {
      if (this.ended) { clearInterval(interval); return }
      try {
        const cleaned = await this.scrapeParticipantNames(page)
        if (cleaned.length) {
          console.log('[teams-bot] Participants:', cleaned.join(', '))
          for (const name of cleaned) {
            opts.onSpeakerEvent?.({ type: 'participant_known', name })
          }
        }
      } catch {}
    }, 5000)
  }

  private async tryOpenRoster(): Promise<void> {
    const page = this.page!
    const selectors = [
      'button[aria-label*="people" i]',
      'button[aria-label*="participants" i]',
      '[data-tid="roster-button"]',
      '#roster-button',
    ]
    for (const sel of selectors) {
      try {
        const btn = await page.$(sel)
        if (btn && await btn.isVisible()) {
          await btn.click()
          console.log('[teams-bot] Opened roster via', sel)
          return
        }
      } catch {}
    }
    console.log('[teams-bot] Could not open roster — using tile scraping')
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
        // Only treat as alone when BOTH the roster is empty AND no in-meeting
        // signal is missing — guards against a selector break causing a
        // premature leave (the bot must positively confirm it is still in-call).
        const stillInMeeting = await this.hasInMeetingSignal(page)
        const others = (await this.scrapeParticipantNames(page)).length
        if (stillInMeeting && others === 0) {
          if (!aloneAt) { aloneAt = Date.now(); console.log('[teams-bot] Alone — will leave in 2 min') }
          else if (Date.now() - aloneAt >= ALONE_MS) {
            console.log('[teams-bot] Alone 2 min — leaving'); clearInterval(iv)
            if (!this.ended) { this.ended = true; onEnded?.(); await this.stop() }
          }
        } else {
          if (aloneAt && others > 0) console.log(`[teams-bot] Participants rejoined (${others})`)
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
        if (!/teams\.(microsoft|live)\.com/i.test(url)) {
          if (!this.ended) {
            this.ended = true
            console.log('[teams-bot] Meeting ended (navigated away from teams)')
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
          return /the meeting (has|was) ended/i.test(text) ||
                 /this meeting (has|was) (already )?ended/i.test(text) ||
                 /you were removed from/i.test(text) ||
                 /call ended/i.test(text)
        })
        if (ended) {
          this.ended = true; clearInterval(iv)
          console.log('[teams-bot] Meeting ended (UI signal)')
          onEnded?.(); await this.stop()
          return
        }
        if (await this.checkBlocked(page)) {
          clearInterval(iv)
          onError?.(new Error(this.blockReason || 'Blocked from Teams meeting'))
          await this.stop()
        }
      } catch {}
    }, 3000)
  }
}

// ── Selectors & helpers ──────────────────────────────────────────────────────
// Teams renames data-tid/aria values periodically. These lists are ordered
// best-known-first; add new variants here when a UI update breaks detection.

const TEAMS_NAME_STOPWORDS = new Set([
  'you', 'me', 'host', 'guest', 'organizer', 'presenter', 'attendee',
  'in this meeting', 'people', 'participants', 'muted', 'unmuted',
  'connecting', 'reconnecting', 'waiting in lobby', 'in the lobby',
])

const NAME_INPUT_SELECTORS = [
  '[data-tid="prejoin-display-name-input"]',
  'input[data-tid="prejoin-display-name-input"]',
  'input[placeholder*="type your name" i]',
  'input[placeholder*="enter name" i]',
  'input[aria-label*="type your name" i]',
  'input[aria-label*="your name" i]',
]

const JOIN_SELECTORS = [
  '[data-tid="prejoin-join-button"]',
  'button[data-tid="prejoin-join-button"]',
  'button:has-text("Join now")',
  'button[aria-label*="join now" i]',
  'button:has-text("Join")',
]

const LEAVE_SELECTORS = [
  '[data-tid="hangup-main-btn"]',
  '#hangup-button',
  'button[aria-label="Leave"]',
  'button[aria-label*="leave" i]',
  'button:has-text("Leave")',
]

// Only elements that exist INSIDE a joined meeting — never on the pre-join
// screen (which also has mute/camera toggles).
const IN_MEETING_SIGNALS = [
  '[data-tid="hangup-main-btn"]',
  '#hangup-button',
  'button[aria-label="Leave"]',
  '[data-tid="roster-button"]',
  '#roster-button',
  '[data-tid="calling-toolbar"]',
  '#call-duration-custom',
]

// Normalize any Teams join link to the web client and force the browser path so
// we skip the "open the desktop app?" interstitial where possible.
export function toTeamsWebClientUrl(url: string): string {
  try {
    const u = new URL(url)
    // teams.live.com (personal) links already open the web client directly.
    if (/teams\.live\.com/i.test(u.hostname)) return url
    // teams.microsoft.com/l/meetup-join/... — drive the light web client.
    if (/teams\.microsoft\.com/i.test(u.hostname)) {
      // Hint Teams to stay on the web instead of bouncing to the desktop app.
      if (!u.searchParams.has('msLaunch')) u.searchParams.set('msLaunch', '0')
      if (!u.searchParams.has('directDl')) u.searchParams.set('directDl', '0')
      if (!u.searchParams.has('enableMobilePage')) u.searchParams.set('enableMobilePage', 'true')
      return u.toString()
    }
    return url
  } catch {
    return url
  }
}
