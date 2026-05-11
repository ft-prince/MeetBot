import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'

export interface BotOptions {
  meetingUrl: string
  displayName?: string
  onAudioChunk?: (chunk: Buffer) => void          // legacy merged audio (unused now)
  onTrackAudio?: (chunk: Buffer, trackId: string) => void  // per-participant audio
  onTrackInfo?: (trackId: string, name: string) => void    // track → participant name
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
      headless: false,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-gpu',
        '--no-first-run',
        '--mute-audio',   // bot never makes sound
      ],
    })

    this.context = await this.browser.newContext({
      permissions: ['microphone', 'camera'],
    })

    this.page = await this.context.newPage()

    this.page.on('crash', () => console.error('[bot] Page crashed'))
    // Forward browser console logs so we can debug the injected script
    this.page.on('console', msg => {
      if (msg.text().startsWith('[NoteAI]')) console.log('[page]', msg.text())
    })

    // Per-track audio: one stream per participant (no mixing)
    await this.page.exposeFunction('noteAISendTrackAudio', (samples: number[], trackId: string) => {
      if (opts.onTrackAudio) {
        const i16 = new Int16Array(samples)
        opts.onTrackAudio(Buffer.from(i16.buffer), trackId)
      }
    })

    // Track → participant name resolved by audioInjector
    await this.page.exposeFunction('noteAISendTrackInfo', (trackId: string, name: string) => {
      opts.onTrackInfo?.(trackId, name)
    })

    await this.page.exposeFunction('noteAISendEvent', (json: string) => {
      if (opts.onSpeakerEvent) {
        try { opts.onSpeakerEvent(JSON.parse(json)) } catch {}
      }
    })

    // Inject audio capture + speaker DOM observer before Meet JS loads
    await this.page.addInitScript({
      path: path.resolve(__dirname, 'audioInjector.js'),
    })

    console.log(`[bot] Navigating to ${meetingUrl}`)
    await this.page.goto(meetingUrl, { waitUntil: 'commit', timeout: 30_000 })

    // Handle the pre-join screen (set name, disable cam/mic, click join)
    await this.handlePreJoin(displayName)

    opts.onJoined?.()
    console.log('[bot] Joined meeting as', displayName)

    // Try to open the participants panel for better name visibility
    await this.tryOpenPeoplePanel()

    // Start polling participants panel for names every 5s
    this.pollParticipantNames(opts)

    // Watch for meeting end
    this.watchForEnd(opts.onEnded)
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

  // Poll the participants panel every 5s and emit speaker events for each person found
  private pollParticipantNames(opts: BotOptions): void {
    const page = this.page!
    const interval = setInterval(async () => {
      if (this.ended) { clearInterval(interval); return }
      try {
        await page.evaluate(async () => {
          // Hover each tile so "More options for <name>" buttons appear
          for (const tile of Array.from(document.querySelectorAll('[data-participant-id]')) as HTMLElement[]) {
            const r = tile.getBoundingClientRect()
            const x = r.x + r.width / 2, y = r.y + r.height / 2
            tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }))
            tile.dispatchEvent(new MouseEvent('mousemove',  { bubbles: true, clientX: x, clientY: y }))
          }
          await new Promise<void>(resolve => setTimeout(resolve, 350))

          // Use ONLY button-revealed names = remote participants.
          // Self-view tile has no "More options for" button → excluded automatically.
          // Bot tile "More options for Note" → filtered by /^note/i.
          // This gives us only real remote participants, in DOM order = WebRTC track order.
          const remoteNames = Array.from(document.querySelectorAll('[data-participant-id]'))
            .map(tile => {
              for (const btn of Array.from(tile.querySelectorAll('button[aria-label]'))) {
                const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
                if (m) return m[1].trim()
              }
              return null
            })
            .filter((n): n is string => !!n && !/^note|recorder/i.test(n) && n.length > 1)

          // Deduplicate names — Meet sometimes shows the same participant in multiple
          // tiles (e.g. pinned + grid view), which shifts track→tile index mapping.
          // Using unique names preserves correct 1-to-1 track→participant pairing.
          const uniqueNames = [...new Set(remoteNames)]

          // Map audio tracks to remote participants by index
          const tracks = (window as unknown as { __noteAITrackList: { trackId: string; index: number }[] }).__noteAITrackList || []
          for (const { trackId, index } of tracks) {
            const name = uniqueNames[index]
            if (name && (window as unknown as Record<string, Function>).noteAISendTrackInfo) {
              ;(window as unknown as Record<string, Function>).noteAISendTrackInfo(trackId, name)
            }
          }
        })

        // Also emit participant_known for correlator fallback
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

    // Click "Leave call" so the bot properly exits the meeting before closing
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

    await this.browser?.close()
    this.browser = null
    this.context = null
    this.page = null
    console.log('[bot] Browser closed')
  }

  // ── Pre-join flow ───────────────────────────────────────────────

  private async handlePreJoin(displayName: string): Promise<void> {
    const page = this.page!

    // Wait for pre-join screen (name input or join button)
    await page.waitForTimeout(2000)

    // Set display name if field is present
    await this.trySetName(page, displayName)

    // Turn off microphone if button is present
    await this.tryMuteMic(page)

    // Turn off camera if button is present
    await this.tryDisableCamera(page)

    // Click "Join now" / "Ask to join"
    await this.tryClickJoin(page)

    // Wait for main meeting UI
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
      '[jsname="Qx7uuf"]',                    // "Join now"
      'button[data-is-confirmed="true"]',
      '[aria-label*="Join now" i]',
      '[aria-label*="Ask to join" i]',
      'button:has-text("Join now")',
      'button:has-text("Ask to join")',
    ]

    // Wait up to 10s for a join button to appear
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
    const selectors = [
      '[data-participant-id]',
      '[data-ssrc]',
      '[jsname="DkfN1b"]',
    ]
    for (let i = 0; i < 30; i++) {
      if (this.ended) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (el) { console.log('[bot] Meeting UI detected'); return }
        } catch { return }
      }
      try { await page.waitForTimeout(1000) } catch { return }
    }
    console.warn('[bot] Meeting UI not detected after 30s — continuing anyway')
  }

  // ── Meeting end detection ───────────────────────────────────────

  private watchForEnd(onEnded?: () => void): void {
    const page = this.page!

    // Detect URL change away from Meet (meeting ended / kicked)
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

    // Detect "You've been removed" or "Meeting ended" dialog
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
        }
      } catch {}
    }, 3000)
  }
}
