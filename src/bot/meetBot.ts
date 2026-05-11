import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'

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

export class MeetBot {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ended = false

  async start(opts: BotOptions): Promise<void> {
    const { meetingUrl, displayName = 'NoteAI Recorder' } = opts

    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-gpu',
        '--no-first-run',
        '--mute-audio',
        '--disable-infobars',
        '--disable-default-apps',
        '--window-size=1280,800',
      ],
    })

    this.context = await this.browser.newContext({
      permissions: ['microphone', 'camera'],
    })

    this.page = await this.context.newPage()

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
    await this.page.waitForTimeout(2000)  // let Meet JS fully initialise

    await this.handlePreJoin(displayName)

    if (this.ended) {
      opts.onError?.(new Error("Bot was blocked from joining the meeting"))
      await this.stop()
      return
    }

    opts.onJoined?.()
    console.log('[bot] Joined meeting as', displayName)

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
        if (btn) { await btn.click(); console.log('[bot] Opened people panel via', sel); return }
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
    if (this.ended) return
    this.ended = true

    if (this.page) {
      try {
        for (const sel of ['[aria-label="Leave call"]', '[jsname="CQylAd"]', 'button:has-text("Leave")']) {
          const btn = await this.page.$(sel)
          if (btn) { await btn.click(); await this.page.waitForTimeout(800); break }
        }
      } catch {}
    }

    await this.browser?.close()
    this.browser = null
    this.context = null
    this.page = null
    console.log('[bot] Browser closed')
  }

  // ── Pre-join ──────────────────────────────────────────────────────────────

  private async handlePreJoin(displayName: string): Promise<void> {
    const page = this.page!
    await page.waitForTimeout(2000)  // wait for pre-join screen to fully render
    await this.trySetName(page, displayName)
    await this.tryMuteMic(page)
    await this.tryDisableCamera(page)
    await this.tryClickJoin(page)
    await this.waitForMeetingUI(page)
  }

  private async trySetName(page: Page, name: string): Promise<void> {
    for (const sel of ['input[placeholder*="name" i]', '[jsname="YPqjbf"]', 'input[data-initial-value]']) {
      try {
        const el = await page.$(sel)
        if (el) { await el.click({ clickCount: 3 }); await el.type(name, { delay: 50 }); console.log('[bot] Set display name'); return }
      } catch {}
    }
  }

  private async tryMuteMic(page: Page): Promise<void> {
    for (const sel of ['[data-is-muted="false"][aria-label*="microphone" i]', '[aria-label*="Turn off microphone" i]', '[jsname="BOHaEe"]']) {
      try { const el = await page.$(sel); if (el) { await el.click(); return } } catch {}
    }
  }

  private async tryDisableCamera(page: Page): Promise<void> {
    for (const sel of ['[aria-label*="Turn off camera" i]', '[data-is-muted="false"][aria-label*="camera" i]', '[jsname="R3RXj"]']) {
      try { const el = await page.$(sel); if (el) { await el.click(); return } } catch {}
    }
  }

  private async tryClickJoin(page: Page): Promise<void> {
    const selectors = [
      '[jsname="Qx7uuf"]',
      '[aria-label*="Join now" i]',
      '[aria-label*="Ask to join" i]',
      'button:has-text("Join now")',
      'button:has-text("Ask to join")',
    ]
    for (let i = 0; i < 20; i++) {
      if (this.ended) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (el) { await el.click(); console.log('[bot] Clicked join button'); return }
        } catch {}
      }
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[bot] Could not find join button — may have auto-joined')
  }

  private async waitForMeetingUI(page: Page): Promise<void> {
    const selectors = ['[data-participant-id]', '[data-ssrc]', '[jsname="DkfN1b"]']
    // Wait up to 5 min — covers waiting rooms where host must admit the bot.
    // Skip the blocked-check for the first 10 s so transient "Ask to join"
    // screens don't cause a false-positive exit before Meet settles.
    const CANT_JOIN_GRACE = 10
    for (let i = 0; i < 300; i++) {
      if (this.ended) return

      if (i >= CANT_JOIN_GRACE && await this.checkCantJoin(page)) return

      for (const sel of selectors) {
        try {
          if (await page.$(sel)) { console.log('[bot] Meeting UI detected'); return }
        } catch { return }
      }

      if (i > 0 && i % 30 === 0) {
        console.log(`[bot] Waiting for meeting UI (${i}s) — may be in waiting room, please admit the bot`)
      }
      await page.waitForTimeout(1000).catch(() => {})
    }
    console.warn('[bot] Meeting UI not detected after 5 min')
    this.ended = true
  }

  /** Only matches the actual full-page error — no false positives from Meet UI text */
  private async checkCantJoin(page: Page): Promise<boolean> {
    try {
      const blocked = await page.evaluate(() => {
        // Must be a prominent heading with the exact error phrase
        for (const el of Array.from(document.querySelectorAll('h1, h2'))) {
          if (/you can.t join this video call/i.test(el.textContent || '')) return true
        }
        return !!document.querySelector('[data-call-error]')
      })
      if (blocked) {
        console.warn("[bot] 'You can't join this video call' — host may need to admit the bot, or meeting requires org sign-in")
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
