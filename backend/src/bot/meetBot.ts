import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { config } from '../config'

export interface BotOptions {
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

// Chrome flags shared across both launch modes
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
  // Anti-detection
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--no-default-browser-check',
  '--disable-extensions-except=',
]

export class MeetBot {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ended = false
  private persistentContext = false   // true when using a saved profile
  private blockReason: string | null = null

  async start(opts: BotOptions): Promise<void> {
    const { meetingUrl, displayName = 'NoteAI Recorder' } = opts

    // Resolve the Chrome profile directory.
    // Priority: BOT_CHROME_PROFILE_DIR env → default ~/.noteai/bot-profile
    // A configured dir that's empty (e.g. fresh Docker volume) falls through to guest mode.
    const defaultProfile = path.join(os.homedir(), '.noteai', 'bot-profile')
    const candidate = config.botChromeProfileDir || defaultProfile
    const hasProfile = fs.existsSync(path.join(candidate, 'Default'))
    const profileDir = hasProfile ? candidate : ''

    if (profileDir) {
      // ── Authenticated mode ──────────────────────────────────────────────
      // Uses a pre-signed-in Google session — required for org-restricted meetings.
      // Run `npx tsx bot-login.ts` once to create the profile.
      console.log(`[bot] Using saved Chrome profile: ${profileDir}`)
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
      // No Google account — works only for meetings that allow guest joins.
      console.log('[bot] No Chrome profile found — joining as guest (may be blocked by org-restricted meetings)')
      console.log('[bot] Run `npx tsx bot-login.ts` once to fix this permanently.')
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

    // Close any stale pages from a previous run (persistent context keeps them open)
    if (this.persistentContext && this.context) {
      const existingPages = this.context.pages()
      for (const p of existingPages) {
        try { await p.close() } catch {}
      }
    }

    this.page = await this.context.newPage()

    // Remove navigator.webdriver — the #1 signal Google uses to detect automation
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol
    })

    this.page.on('crash', () => console.error('[bot] Page crashed'))
    this.page.on('console', msg => {
      if (msg.text().startsWith('[NoteAI]')) console.log('[page]', msg.text())
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
      path: path.resolve(__dirname, 'audioInjector.js'),
    })

    console.log(`[bot] Navigating to ${meetingUrl}`)
    await this.page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    console.log('[bot] Page loaded — waiting for Meet JS to settle')
    await this.page.waitForTimeout(3000)  // let Meet JS + account check fully settle

    console.log('[bot] Starting pre-join flow')
    await this.handlePreJoin(displayName)

    if (this.ended) {
      const msg = this.blockReason
        ? `Bot blocked from joining: ${this.blockReason}. Re-run \`npx tsx bot-login.ts\` with an account that has access, or ask the host to admit guests.`
        : 'Bot was blocked from joining the meeting (no admit within 5 min — host never let the bot in)'
      console.error(`[bot] Join failed: ${msg}`)
      opts.onError?.(new Error(msg))
      await this.stop()
      return
    }

    opts.onJoined?.()
    console.log(`[bot] Joined meeting as "${displayName}" — setting up post-join watchers`)

    await this.tryOpenPeoplePanel()
    this.pollParticipantNames(opts)
    this.watchForAlone(opts.onEnded)
    this.watchForEnd(opts.onEnded, opts.onError)
  }

  // ── People panel ─────────────────────────────────────────────────────────

  private async tryOpenPeoplePanel(): Promise<void> {
    const page = this.page!
    const selectors = [
      '[aria-label*="people" i]',
      '[aria-label*="participant" i]',
      '[data-panel-id="1"]',
      '[jsname="A5il2e"]',
    ]
    for (const sel of selectors) {
      try {
        const btn = await page.$(sel)
        if (btn && await btn.isVisible()) {
          await btn.click()
          console.log('[bot] Opened people panel via', sel)
          return
        }
      } catch {}
    }
    console.log('[bot] Could not open people panel — will scrape tiles instead')
  }

  // ── Participant name polling ───────────────────────────────────────────────

  private pollParticipantNames(opts: BotOptions): void {
    const page = this.page!
    const interval = setInterval(async () => {
      if (this.ended) { clearInterval(interval); return }
      try {
        await page.evaluate(async () => {
          for (const tile of Array.from(document.querySelectorAll('[data-participant-id]')) as HTMLElement[]) {
            const r = tile.getBoundingClientRect()
            const x = r.x + r.width / 2, y = r.y + r.height / 2
            tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }))
            tile.dispatchEvent(new MouseEvent('mousemove',  { bubbles: true, clientX: x, clientY: y }))
          }
          await new Promise<void>(resolve => setTimeout(resolve, 350))

          const remoteNames = Array.from(document.querySelectorAll('[data-participant-id]'))
            .map(tile => {
              for (const btn of Array.from(tile.querySelectorAll('button[aria-label]'))) {
                const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
                if (m) return m[1].trim()
              }
              return null
            })
            .filter((n): n is string => !!n && !/^note|recorder/i.test(n) && n.length > 1)

          const uniqueNames = [...new Set(remoteNames)]
          const tracks = (window as unknown as { __noteAITrackList: { trackId: string; index: number }[] }).__noteAITrackList || []
          for (const { trackId, index } of tracks) {
            const name = uniqueNames[index]
            if (name && (window as unknown as Record<string, Function>).noteAISendTrackInfo) {
              ;(window as unknown as Record<string, Function>).noteAISendTrackInfo(trackId, name)
            }
          }
        })

        const names = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-participant-id]')).map(tile => {
            for (const btn of Array.from(tile.querySelectorAll('button[aria-label]'))) {
              const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
              if (m) return m[1].trim()
            }
            return ''
          }).filter(n => n.length > 1)
        )

        const unique = [...new Set(names)].filter(n =>
          !/^note/i.test(n) && !/recorder/i.test(n) &&
          n !== 'You' && !/^\d/.test(n) && !/participants?/i.test(n) &&
          n.length >= 2 && n.length <= 50
        )
        if (unique.length) {
          console.log('[bot] Participants:', unique.join(', '))
          for (const name of unique) {
            opts.onSpeakerEvent?.({ type: 'participant_known', name })
          }
        }
      } catch {}
    }, 5000)
  }

  // ── Stop ─────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    // Capture refs atomically before clearing. Null refs = already cleaned up.
    // Do NOT guard on `this.ended` — internal watchers set that flag before calling
    // stop(), which would cause the early-return to skip browser cleanup entirely,
    // leaving zombie browsers that hold the persistent-profile lock.
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
        for (const sel of ['[aria-label="Leave call"]', '[jsname="CQylAd"]', 'button:has-text("Leave")']) {
          const btn = await page.$(sel)
          if (btn) { await btn.click(); await page.waitForTimeout(800); break }
        }
      } catch {}
    }

    try {
      if (wasPersistent) {
        // Close context only — keeps the profile intact for next run
        await context?.close()
      } else {
        await browser?.close()
      }
    } catch {}

    console.log('[bot] Browser closed')
  }

  // ── Pre-join ──────────────────────────────────────────────────────────────

  private async handlePreJoin(displayName: string): Promise<void> {
    const page = this.page!
    // Wait for the pre-join lobby to actually render instead of sleeping a fixed amount.
    // Google Meet is a heavy SPA — DOM elements exist before they're interactive.
    await this.waitForPreJoinUI(page)
    await this.trySetName(page, displayName)
    await this.tryMuteMic(page)
    await this.tryDisableCamera(page)
    await this.tryClickJoin(page)
    await this.waitForMeetingUI(page)
  }

  // Wait until the pre-join screen has a visible interactive element (name field OR join button).
  // Falls through after 30 s so the rest of the flow still runs.
  private async waitForPreJoinUI(page: Page): Promise<void> {
    const signals = [
      'input[placeholder*="name" i]',
      '[jsname="YPqjbf"]',
      '[aria-label*="Join now" i]',
      '[aria-label*="Ask to join" i]',
      'button:has-text("Join now")',
      'button:has-text("Ask to join")',
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return

      if (await this.hasLeaveButton(page)) {
        console.log('[bot] Already in meeting — skipping pre-join wait')
        return
      }

      for (const sel of signals) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible()) {
            console.log(`[bot] Pre-join UI ready via "${sel}" (+${Math.round((Date.now() - startMs) / 1000)}s)`)
            return
          }
        } catch {}
      }

      const elapsed = Math.round((Date.now() - startMs) / 1000)
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`[bot] Waiting for pre-join UI (${elapsed}s)...`)
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[bot] Pre-join UI not detected after 30s — proceeding anyway')
  }

  private async trySetName(page: Page, name: string): Promise<void> {
    for (const sel of ['input[placeholder*="name" i]', '[jsname="YPqjbf"]', 'input[data-initial-value]']) {
      try {
        const el = await page.$(sel)
        if (!el || !(await el.isVisible())) continue
        // fill() is required for React controlled inputs: it fires the synthetic `input`
        // event that React listens to. el.type() only fires keydown/keyup and leaves
        // React's internal form state unchanged, so Meet submits the empty default name.
        await el.click()
        await el.fill(name)
        const actual = await el.inputValue()
        if (actual === name) {
          console.log(`[bot] Display name set: "${name}"`)
        } else {
          console.warn(`[bot] Display name mismatch — expected "${name}", got "${actual}"`)
        }
        return
      } catch {}
    }
    console.warn('[bot] Name field not found — joining without setting display name')
  }

  private async tryMuteMic(page: Page): Promise<void> {
    for (const sel of ['[data-is-muted="false"][aria-label*="microphone" i]', '[aria-label*="Turn off microphone" i]', '[jsname="BOHaEe"]']) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) { await el.click(); return }
      } catch {}
    }
  }

  private async tryDisableCamera(page: Page): Promise<void> {
    for (const sel of ['[aria-label*="Turn off camera" i]', '[data-is-muted="false"][aria-label*="camera" i]', '[jsname="R3RXj"]']) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) { await el.click(); return }
      } catch {}
    }
  }

  // Retry clicking the join button for up to 30 s, only on elements that are
  // both visible AND enabled. Previous code clicked DOM elements that existed
  // but weren't interactive yet, causing a silent no-op.
  private async tryClickJoin(page: Page): Promise<void> {
    const selectors = [
      '[jsname="Qx7uuf"]',
      '[aria-label*="Join now" i]',
      '[aria-label*="Ask to join" i]',
      'button:has-text("Join now")',
      'button:has-text("Ask to join")',
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (!el) continue
          const visible = await el.isVisible()
          const enabled = await el.isEnabled()
          if (visible && enabled) {
            await el.click()
            console.log(`[bot] Clicked join button via "${sel}" (+${Math.round((Date.now() - startMs) / 1000)}s)`)
            return
          }
        } catch {}
      }
      const elapsed = Math.round((Date.now() - startMs) / 1000)
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`[bot] Waiting for join button to be visible+enabled (${elapsed}s)...`)
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[bot] Join button not found/interactive after 30s — may have auto-joined or landed in waiting room')
  }

  private async hasLeaveButton(page: Page): Promise<boolean> {
    for (const sel of ['[aria-label="Leave call"]', '[aria-label*="leave call" i]', '[jsname="CQylAd"]']) {
      try { if (await page.$(sel)) return true } catch {}
    }
    return false
  }

  private async waitForMeetingUI(page: Page): Promise<void> {
    // Strategy: the pre-join lobby has BOTH [data-participant-id] tiles (camera previews)
    // AND a visible join/ask-to-join button.  Once inside the actual meeting, the
    // join button is gone but participant tiles are still present.
    // Waiting room: join button gone, no participant tiles yet — keep looping until admitted.
    // Leave-call button is the gold-standard in-meeting signal (fallback).
    const JOIN_BTNS = [
      '[jsname="Qx7uuf"]',
      '[aria-label*="Join now" i]',
      '[aria-label*="Ask to join" i]',
    ]
    const CANT_JOIN_GRACE = 5   // seconds before we check for hard block

    const hasJoinButton = async (): Promise<boolean> => {
      for (const sel of JOIN_BTNS) {
        try { if (await page.$(sel)) return true } catch {}
      }
      return false
    }

    for (let i = 0; i < 300; i++) {
      if (this.ended) return

      // Only check for hard block after grace period — waiting rooms can look like errors
      if (i >= CANT_JOIN_GRACE && await this.checkCantJoin(page)) return

      try {
        // In meeting: leave button visible (most reliable)
        if (await this.hasLeaveButton(page)) {
          console.log('[bot] Meeting UI detected (leave button)'); return
        }

        // In meeting: participant tiles visible AND join button is gone
        // (join button present = still on pre-join lobby, not yet inside)
        const tiles = await page.$('[data-participant-id]')
        if (tiles && !(await hasJoinButton())) {
          console.log('[bot] Meeting UI detected (tiles + no join button)'); return
        }
      } catch {
        // Page navigating — wait a tick and retry
      }

      if (i > 0 && i % 30 === 0) {
        console.log(`[bot] Waiting for meeting UI (${i}s) — may be in waiting room, please admit the bot`)
      }
      await page.waitForTimeout(1000).catch(() => {})
    }
    console.warn('[bot] Meeting UI not detected after 5 min')
    this.ended = true
  }

  private async checkCantJoin(page: Page): Promise<boolean> {
    try {
      // Match the explicit "you can't join" text anywhere on the page. Google Meet renders
      // this error in plain divs/spans (not just headings), and shows a "Return to home screen"
      // button that's unique to the block page — never present in the waiting room.
      const reason = await page.evaluate(() => {
        const bodyText = (document.body.innerText || '').slice(0, 4000)
        const cantJoin = /you can.t join this video call/i.test(bodyText)
        const returnHome = /return to home screen/i.test(bodyText)
        const notAllowed = /you.re not allowed|isn.t allowed to join|host hasn.t (admitted|let) you|denied your request/i.test(bodyText)
        if (!cantJoin && !returnHome && !notAllowed) return null

        // Pick the most specific reason text we can find so the user knows why.
        const reasonMatch = bodyText.match(
          /(you.re not (signed in|allowed)[^.]*\.?|switch to (an|a different) account[^.]*\.?|this meeting is for[^.]*\.?|host hasn.t (admitted|let) you[^.]*\.?|denied your request[^.]*\.?|isn.t allowed to join[^.]*\.?)/i
        )
        return reasonMatch ? reasonMatch[0].trim() : 'You can\'t join this video call'
      })
      if (reason) {
        console.warn(`[bot] Blocked from joining: ${reason}`)
        console.warn('[bot] Fix: re-run `npx tsx bot-login.ts` with a Google account that has access to this meeting, or ask the host to allow guest joins.')
        this.blockReason = reason
        this.ended = true
        return true
      }
    } catch {}
    return false
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
        const count = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-participant-id]')).filter(t =>
            Array.from(t.querySelectorAll('button[aria-label]')).some(b =>
              /^More options for /i.test(b.getAttribute('aria-label') || '')
            )
          ).length
        )
        if (count === 0) {
          if (!aloneAt) { aloneAt = Date.now(); console.log('[bot] Alone — will leave in 2 min') }
          else if (Date.now() - aloneAt >= ALONE_MS) {
            console.log('[bot] Alone 2 min — leaving'); clearInterval(iv)
            if (!this.ended) { this.ended = true; onEnded?.(); await this.stop() }
          }
        } else {
          if (aloneAt) console.log(`[bot] Participants rejoined (${count})`)
          aloneAt = null
        }
      } catch {}
    }, CHECK_MS)
  }

  // ── End detection ─────────────────────────────────────────────────────────

  private watchForEnd(onEnded?: () => void, onError?: (err: Error) => void): void {
    const page = this.page!

    page.on('framenavigated', frame => {
      if (frame === page.mainFrame() && !frame.url().includes('meet.google.com')) {
        if (!this.ended) {
          this.ended = true
          console.log('[bot] Meeting ended (navigated away)')
          onEnded?.(); this.stop()
        }
      }
    })

    const iv = setInterval(async () => {
      if (this.ended) { clearInterval(iv); return }
      try {
        if (await page.$('[data-call-ended], [jsname="r8qRAd"]')) {
          this.ended = true; clearInterval(iv)
          console.log('[bot] Meeting ended (UI signal)')
          onEnded?.(); await this.stop(); return
        }
        if (await this.checkCantJoin(page)) {
          clearInterval(iv)
          onError?.(new Error("Can't join — host denied or org-restricted meeting"))
          await this.stop()
        }
      } catch {}
    }, 3000)
  }
}