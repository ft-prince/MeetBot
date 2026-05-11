import { chromium, BrowserContext, Page } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'

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

// Persistent profile dir — session cookies survive between bot restarts
const BOT_PROFILE_DIR = process.env.BOT_CHROME_PROFILE_DIR ||
  path.join(os.homedir(), '.noteai', 'bot-profile')

export class MeetBot {
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ended = false

  async start(opts: BotOptions): Promise<void> {
    const { meetingUrl, displayName = 'NoteAI Recorder' } = opts

    // Ensure profile dir exists
    fs.mkdirSync(BOT_PROFILE_DIR, { recursive: true })
    console.log(`[bot] Using persistent profile: ${BOT_PROFILE_DIR}`)

    const ARGS = [
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
    ]

    // launchPersistentContext saves cookies/session — bot stays logged in
    this.context = await chromium.launchPersistentContext(BOT_PROFILE_DIR, {
      headless: false,
      args: ARGS,
      permissions: ['microphone', 'camera'],
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
    await this.page.goto(meetingUrl, { waitUntil: 'commit', timeout: 30_000 })
    // Brief pause for Meet JS to initialize before pre-join interaction
    await this.page.waitForTimeout(2000)

    await this.handlePreJoin(displayName)

    if (this.ended) {
      // Blocked during pre-join (can't join error)
      opts.onError?.(new Error("Bot was blocked from joining — check account permissions"))
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

        const names = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('[data-participant-id]')).map(tile => {
            for (const btn of Array.from(tile.querySelectorAll('button[aria-label]'))) {
              const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
              if (m) return m[1].trim()
            }
            const raw = (tile.textContent || '').replace(/\s+/g, ' ').trim()
            const m = raw.replace(/\s*devices\s*$/i, '').trim().match(/^(.{2,40})\1/)
            return m ? m[1].trim() : ''
          }).filter(n => n.length > 1)
        })

        const unique = [...new Set(names)].filter(n =>
          !/^note/i.test(n) && !/recorder/i.test(n) &&
          n !== 'You' && !/^\d/.test(n) && !/participants?/i.test(n) &&
          n.length >= 2 && n.length <= 50
        )
        if (unique.length) {
          console.log('[bot] Participants (filtered):', unique.join(', '))
          for (const name of unique) {
            opts.onSpeakerEvent?.({
              type: 'participant_known', name, meetingId: this.page?.url().match(/\/([a-z-]+)$/)?.[1]
            })
          }
        }
      } catch {}
    }, 5000)
  }

  async stop(): Promise<void> {
    if (this.ended) return
    this.ended = true

    if (this.page) {
      try {
        const leaveSelectors = [
          '[aria-label="Leave call"]',
          '[jsname="CQylAd"]',
          'button:has-text("Leave")',
        ]
        for (const sel of leaveSelectors) {
          const btn = await this.page.$(sel)
          if (btn) {
            await btn.click()
            console.log('[bot] Clicked leave call button')
            await this.page.waitForTimeout(800)
            break
          }
        }
      } catch { /* page may already be gone */ }
    }

    await this.context?.close()
    this.context = null
    this.page = null
    console.log('[bot] Browser closed')
  }

  // ── Pre-join flow ──────────────────────────────────────────────────────────

  private async handlePreJoin(displayName: string): Promise<void> {
    const page = this.page!
    await this.trySetName(page, displayName)
    await this.tryMuteMic(page)
    await this.tryDisableCamera(page)
    await this.tryClickJoin(page)
    await this.waitForMeetingUI(page)
  }

  private async trySetName(page: Page, name: string): Promise<void> {
    const selectors = [
      'input[placeholder*="name" i]',
      'input[placeholder*="Name" i]',
      '[jsname="YPqjbf"]',
      'input[data-initial-value]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el) {
          await el.click({ clickCount: 3 })
          await el.type(name, { delay: 50 })
          console.log('[bot] Set display name to', name)
          return
        }
      } catch {}
    }
  }

  private async tryMuteMic(page: Page): Promise<void> {
    const selectors = [
      '[data-is-muted="false"][aria-label*="microphone" i]',
      '[aria-label*="Turn off microphone" i]',
      '[jsname="BOHaEe"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el) { await el.click(); return }
      } catch {}
    }
  }

  private async tryDisableCamera(page: Page): Promise<void> {
    const selectors = [
      '[aria-label*="Turn off camera" i]',
      '[data-is-muted="false"][aria-label*="camera" i]',
      '[jsname="R3RXj"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el) { await el.click(); return }
      } catch {}
    }
  }

  private async tryClickJoin(page: Page): Promise<void> {
    const selectors = [
      '[jsname="Qx7uuf"]',
      'button[data-is-confirmed="true"]',
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
          if (el) {
            await el.click()
            console.log('[bot] Clicked join button')
            return
          }
        } catch {}
      }
      try { await page.waitForTimeout(500) } catch { return }
    }
    console.warn('[bot] Could not find join button — meeting may have auto-joined')
  }

  private async waitForMeetingUI(page: Page): Promise<void> {
    const selectors = ['[data-participant-id]', '[data-ssrc]', '[jsname="DkfN1b"]']
    // Wait up to 5 minutes — covers waiting rooms where host must admit the bot
    for (let i = 0; i < 300; i++) {
      if (this.ended) return
      if (await this.checkCantJoin(page)) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (el) { console.log('[bot] Meeting UI detected'); return }
        } catch { return }
      }
      if (i > 0 && i % 30 === 0) {
        console.log(`[bot] Waiting for meeting UI (${i}s) — may be in waiting room`)
      }
      try { await page.waitForTimeout(1000) } catch { return }
    }
    console.warn('[bot] Meeting UI not detected after 5 minutes — giving up')
    this.ended = true
  }

  private async checkCantJoin(page: Page): Promise<boolean> {
    try {
      const blocked = await page.evaluate(() => {
        // Only match the exact full-page error — not partial text in tooltips/links
        const h1 = document.querySelector('h1, h2')?.textContent || ''
        const hasErrorHeading = /you can.t join this video call/i.test(h1)
        const hasErrorEl = !!document.querySelector('[data-call-error], [jsname="r8qRAd"]')
        // URL leaves meet.google.com entirely (e.g. redirected to accounts or error page)
        const leftMeet = !location.href.includes('meet.google.com')
        return hasErrorHeading || hasErrorEl || leftMeet
      })
      if (blocked) {
        console.warn("[bot] Blocked: 'You can't join this video call'")
        this.ended = true
        return true
      }
    } catch {}
    return false
  }

  // ── Alone detection ───────────────────────────────────────────────────────

  private watchForAlone(onEnded?: () => void): void {
    const page = this.page!
    const ALONE_LIMIT_MS = 2 * 60 * 1000
    const CHECK_INTERVAL_MS = 30_000
    const GRACE_MS = 60_000
    let aloneStartedAt: number | null = null
    const joinedAt = Date.now()

    const interval = setInterval(async () => {
      if (this.ended) { clearInterval(interval); return }
      if (Date.now() - joinedAt < GRACE_MS) return
      try {
        const remoteCount = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-participant-id]')).filter(tile =>
            Array.from(tile.querySelectorAll('button[aria-label]')).some(btn =>
              (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
            )
          ).length
        )
        if (remoteCount === 0) {
          if (aloneStartedAt === null) {
            aloneStartedAt = Date.now()
            console.log('[bot] Alone in meeting — will leave in 2 minutes if no one joins')
          } else if (Date.now() - aloneStartedAt >= ALONE_LIMIT_MS) {
            console.log('[bot] Been alone for 2 minutes — leaving meeting')
            clearInterval(interval)
            if (!this.ended) { this.ended = true; onEnded?.(); await this.stop() }
          }
        } else {
          if (aloneStartedAt !== null) console.log(`[bot] Participants rejoined (${remoteCount})`)
          aloneStartedAt = null
        }
      } catch {}
    }, CHECK_INTERVAL_MS)
  }

  // ── Meeting end detection ─────────────────────────────────────────────────

  private watchForEnd(onEnded?: () => void, onError?: (err: Error) => void): void {
    const page = this.page!

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && !frame.url().includes('meet.google.com/')) {
        if (!this.ended) {
          this.ended = true
          console.log('[bot] Meeting ended (navigation away)')
          onEnded?.()
          this.stop()
        }
      }
    })

    const checkEndedUI = setInterval(async () => {
      if (this.ended) { clearInterval(checkEndedUI); return }
      try {
        const ended = await page.$('[data-call-ended], [jsname="r8qRAd"]')
        if (ended) {
          this.ended = true
          clearInterval(checkEndedUI)
          console.log('[bot] Meeting ended (UI signal)')
          onEnded?.()
          await this.stop()
          return
        }
        const blocked = await this.checkCantJoin(page)
        if (blocked) {
          clearInterval(checkEndedUI)
          onError?.(new Error("Can't join: meeting requires Google sign-in or host denied admission"))
          await this.stop()
        }
      } catch {}
    }, 3000)
  }
}
