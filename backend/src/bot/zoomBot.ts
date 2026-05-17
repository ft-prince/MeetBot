import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { config } from '../config'

export interface BotOptions {
  meetingUrl: string
  displayName?: string
  passcode?: string
  onAudioChunk?: (chunk: Buffer) => void
  onTrackAudio?: (chunk: Buffer, trackId: string) => void
  onTrackInfo?: (trackId: string, name: string) => void
  onSpeakerEvent?: (event: Record<string, unknown>) => void
  onJoined?: () => void
  onEnded?: () => void
  onError?: (err: Error) => void
}

const CHROME_ARGS = [
  '--auto-accept-this-tab-capture',
  '--enable-features=GetDisplayMediaSetAutoSelectAllScreens',
  //above are 2 new chrome flags for capturing the audio from tab
  '--no-sandbox',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-gpu',
  '--no-first-run',
  '--disable-infobars',
  '--disable-default-apps',
  '--window-size=1280,800',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--no-default-browser-check',
  '--disable-extensions-except=',
  '--allow-running-insecure-content',
  '--enable-usermedia-screen-capturing',
]

export class ZoomBot {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ended = false
  private persistentContext = false
  private blockReason: string | null = null
  private manualJoin = true

  private getWebClientUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      const match = urlObj.pathname.match(/\/j\/(\d+)/)
      if (match) {
        const meetingId = match[1]
        return `${urlObj.origin}/wc/${meetingId}/join${urlObj.search}`
      }
      return url
    } catch {
      return url
    }
  }

  async start(opts: BotOptions): Promise<void> {
    const { displayName = 'NoteAI Recorder' } = opts
    const meetingUrl = this.getWebClientUrl(opts.meetingUrl)

    const defaultProfile = path.join(os.homedir(), '.noteai', 'zoom-bot-profile')
    const candidate = config.botChromeProfileDir || defaultProfile
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
      const existingPages = this.context.pages()
      for (const p of existingPages) {
        try { await p.close() } catch {}
      }
    }

    this.page = await this.context.newPage()

    // ── Anti-detection ────────────────────────────────────────────────────
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol
    })

    // ── Page event listeners ──────────────────────────────────────────────
    this.page.on('crash', () => console.error('[zoom-bot] Page crashed'))
    this.page.on('console', msg => {
      if (msg.text().startsWith('[NoteAI]')) console.log('[page]', msg.text())
    })

    // ── Expose IPC bridge functions BEFORE addInitScript ─────────────────
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

    // ── Inject audio interceptor ──────────────────────────────────────────
    // await this.page.addInitScript({
    //   path: path.resolve(__dirname, 'zoomAudioInjector.js'),
    // })

    //Inject Tab Audio
    await this.page.addInitScript({
      path: path.resolve(__dirname, 'zoomTabAudioCapture.js'),
    })

    // ── Navigate ──────────────────────────────────────────────────────────
    console.log(`[zoom-bot] Navigating to ${meetingUrl}`)
    await this.page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    console.log('[zoom-bot] Page loaded — waiting for Zoom JS to settle')
    await this.page.waitForTimeout(3000)

    // ── Verify injector loaded ────────────────────────────────────────────
    const injectorLoaded = await this.page.evaluate(() => {
      return (window as any).__noteAIInjectorLoaded === true
    })
    console.log(`[zoom-bot] Audio injector active: ${injectorLoaded}`)

    console.log('[zoom-bot] Starting pre-join flow')
    await this.handlePreJoin(displayName, opts.passcode)

    if (this.ended) {
      const msg = this.blockReason
        ? `Bot blocked from joining: ${this.blockReason}.`
        : 'Bot was blocked from joining the meeting (no admit within 5 min — host never let the bot in)'
      console.error(`[zoom-bot] Join failed: ${msg}`)
      opts.onError?.(new Error(msg))
      await this.stop()
      return
    }

    opts.onJoined?.()
    console.log(`[zoom-bot] Joined meeting as "${displayName}" — setting up post-join watchers`)

    await this.activateComputerAudio()

    // Trigger tab audio capture via a synthetic click (provides user-gesture context)
    console.log('[zoom-bot] Setting up tab capture trigger...')
    try {
      const setupResult = await this.page.evaluate(() => {
        const fnExists = typeof (window as any).__startNoteAITabCapture === 'function'
        const btn = document.createElement('button')
        btn.id = '__noteai-cap-trigger'
        btn.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0;z-index:2147483647;'
        btn.addEventListener('click', () => {
          console.log('[NoteAI] Trigger clicked')
          const fn = (window as any).__startNoteAITabCapture
          if (typeof fn === 'function') fn()
          else console.error('[NoteAI] __startNoteAITabCapture missing at click time')
        })
        document.body.appendChild(btn)
        return { fnExists, btnAdded: !!document.getElementById('__noteai-cap-trigger') }
      })
      console.log('[zoom-bot] Setup result:', JSON.stringify(setupResult))

      await this.page.click('#__noteai-cap-trigger',{force: true})
      console.log('[zoom-bot] Click dispatched')
    } catch (err) {
      console.error('[zoom-bot] Tab capture trigger error:', (err as Error).message)
    }

    //till here
  
    await this.tryOpenPeoplePanel()
    this.pollParticipantNames(opts)
    this.watchForAlone(opts.onEnded)
    this.watchForEnd(opts.onEnded, opts.onError)

    // Temporary: re-verify audio after participants have had time to join and speak
    setTimeout(async () => {
      if (this.ended || !this.page) return
      console.log("[zoom-bot] 15s post-join audio re-check...")
      await this.verifyAudioTracksActive(this.page)
    }, 15_000)

    setTimeout(async () => {
      if (this.ended || !this.page) return
      console.log("[zoom-bot] 30s post-join audio re-check...")
      await this.verifyAudioTracksActive(this.page)
    }, 30_000)

    setTimeout(async () => {
      if (this.ended || !this.page) return
      console.log("[zoom-bot] 60s post-join audio re-check...")
      await this.verifyAudioTracksActive(this.page)
    }, 60_000)

    // Temporary: dump participant DOM every 10s to find correct selectors
    const debugInterval = setInterval(async () => {
      if (this.ended) { clearInterval(debugInterval); return }
      try {
        const result = await this.page!.evaluate(() => {
          return {
            videoCount: document.querySelectorAll('video').length,
            nameSelectors: [
              'span.participant-item__display-name',
              '.participants-item__display-name',
              '[class*="display-name"]',
              '[class*="participant-name"]',
              '[class*="user-name"]',
              '[class*="avatar-name"]',
            ].map(sel => ({
              sel,
              count: document.querySelectorAll(sel).length,
              names: Array.from(document.querySelectorAll(sel))
                .map((el: Element) => (el as HTMLElement).innerText?.trim())
                .filter(Boolean)
            })),
            nameClassElements: Array.from(document.querySelectorAll('[class*="name"]'))
              .slice(0, 20)
              .map((el: Element) => ({
                cls: (el as HTMLElement).className,
                text: (el as HTMLElement).innerText?.trim().slice(0, 40)
              }))
          }
        })
        console.log('[zoom-bot] Participant DOM:', JSON.stringify(result, null, 2))
      } catch {}
    }, 10_000)
  }

  // ── Pre-join ──────────────────────────────────────────────────────────────

  private async handlePreJoin(displayName: string, passcode?: string): Promise<void> {
    const page = this.page!
    await this.dismissCookies(page)
    await this.waitForPreJoinUI(page)

    if (this.ended) return

    if (this.manualJoin) {
      // FIX: wait until the bot is genuinely inside the meeting before returning.
      // Previously returned immediately, causing onJoined() to fire while still
      // on the pre-join screen — making watchForEnd() false-trigger on the modal.
      console.log('[zoom-bot] Manual join enabled — waiting for user to join the meeting')
      await this.waitForMeetingUI(page)
      return
    }

    await this.trySetName(page, displayName)
    if (passcode) await this.trySetPasscode(page, passcode)
    await this.tryClickJoin(page)
    await this.waitForMeetingUI(page)
  }

  private async dismissCookies(page: Page): Promise<void> {
    try {
      const btn = await page.$('button#onetrust-accept-btn-handler')
      if (btn && await btn.isVisible()) {
        await btn.click()
        await page.waitForTimeout(1000)
        console.log('[zoom-bot] Dismissed cookie popup')
      }
    } catch {}
  }

  private async waitForPreJoinUI(page: Page): Promise<void> {
    const signals = [
      'input[name="inputname"]',
      'input#inputname',
      'button.preview-join-button',
      'button:has-text("Join")',
      'input#inputpasscode',
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return

      if (await this.hasLeaveButton(page)) {
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
      await page.waitForTimeout(500).catch(() => {})
    }
    console.warn('[zoom-bot] Pre-join UI not detected after 30s — proceeding anyway')
  }

  private async trySetName(page: Page, name: string): Promise<void> {
    for (const sel of ['input[name="inputname"]', 'input#inputname']) {
      try {
        const el = await page.$(sel)
        if (!el || !(await el.isVisible())) continue
        await el.click()
        await el.fill(name)
        console.log(`[zoom-bot] Display name set: "${name}"`)
        return
      } catch {}
    }
  }

  private async trySetPasscode(page: Page, passcode: string): Promise<void> {
    try {
      const el = await page.$('input#inputpasscode')
      if (el && await el.isVisible()) {
        await el.fill(passcode)
        console.log('[zoom-bot] Passcode filled')
      }
    } catch {}
  }

  private async tryClickJoin(page: Page): Promise<void> {
    const selectors = [
      'button.preview-join-button',
      'button:has-text("Join")',
      '#joinBtn',
    ]
    const startMs = Date.now()
    const TIMEOUT_MS = 30_000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return
      for (const sel of selectors) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible() && await el.isEnabled()) {
            await el.click()
            console.log(`[zoom-bot] Clicked join button via "${sel}"`)
            return
          }
        } catch {}
      }
      await page.waitForTimeout(500).catch(() => {})
    }
  }

  // ── Audio Activation ──────────────────────────────────────────────────────

  private async activateComputerAudio(): Promise<void> {
    const page = this.page!

    // Step 1: Dismiss any "choose audio" modal first
    const audioModalSelectors = [
      'button:has-text("Computer Audio")',
      '[aria-label="Computer Audio"]',
      'div[class*="audio-option"]:has-text("Computer Audio")',
    ]

    console.log('[zoom-bot] Checking for audio modal...')
    for (let i = 0; i < 10; i++) {
      if (this.ended) return
      for (const sel of audioModalSelectors) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible()) {
            await el.click()
            console.log(`[zoom-bot] Clicked audio modal option: "${sel}"`)
            await page.waitForTimeout(1500)
            break
          }
        } catch {}
      }
      await page.waitForTimeout(500)
    }

    // Step 2: Click the "Join Audio by Computer" confirmation button
    const joinAudioSelectors = [
      'button.join-audio-by-voip__join-btn',
      'button:has-text("Join Audio by Computer")',
      '[aria-label="Join Audio by Computer"]',
      'button[aria-label*="audio" i]',
      '[class*="join-audio"]',
      '[class*="voip-button"]',
    ]

    console.log('[zoom-bot] Attempting to activate computer audio...')
    for (let attempt = 0; attempt < 30; attempt++) {
      if (this.ended) return

      // Check if audio is already active (mute button present = already joined audio)
      const alreadyJoined = await page.evaluate(() => {
        const muteBtn = document.querySelector(
          'button[aria-label*="mute" i], button[aria-label*="unmute" i], ' +
          '[class*="mute-button"], [class*="audio-button"]'
        )
        return !!muteBtn
      })

      if (alreadyJoined) {
        console.log('[zoom-bot] Audio already active (mute button detected) ✓')
        await this.tryMuteMic(page)
        await page.waitForTimeout(2000)
        await this.verifyAudioTracksActive(page)
        return
      }

      for (const sel of joinAudioSelectors) {
        try {
          const el = await page.$(sel)
          if (el && await el.isVisible()) {
            await el.click()
            console.log(`[zoom-bot] Clicked join audio: "${sel}" ✓`)
            await page.waitForTimeout(1500)
            await this.tryMuteMic(page)
            await page.waitForTimeout(2000)
            await this.verifyAudioTracksActive(page)
            return
          }
        } catch {}
      }

      await page.waitForTimeout(1000)
    }

    // Step 3: Last resort — keyboard shortcut
    console.warn('[zoom-bot] All selectors failed — trying Alt+A shortcut')
    try {
      await page.keyboard.press('Alt+a')
      await page.waitForTimeout(2000)
      await this.verifyAudioTracksActive(page)
    } catch {}
  }

  private async verifyAudioTracksActive(page: Page): Promise<void> {
    console.log('[zoom-bot] Verifying audio capture...')

    const state = await page.evaluate(() => {
      // @ts-ignore
      const trackList: {trackId: string, index: number}[] = window.__noteAITrackList || []
      const hasMixedTrack = trackList.some(t => t.trackId.startsWith('mixed'))
      return { hasMixedTrack, trackList }
    })

    if (state.hasMixedTrack) {
      console.log('[zoom-bot] ✓ AudioContext loopback tap active — audio flowing via mixed track')
    } else {
      console.warn('[zoom-bot] ⚠ AudioContext tap not yet installed — Zoom may not have created its AudioContext yet')
    }
  }

  private async tryMuteMic(page: Page): Promise<void> {
    for (const sel of [
      'button[aria-label^="mute my microphone" i]',
      '.audio-option__button:has-text("Mute")',
      'button[aria-label="Mute"]',
    ]) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) {
          await el.click()
          console.log('[zoom-bot] Muted mic')
          return
        }
      } catch {}
    }
  }

  // ── Meeting State & Observers ─────────────────────────────────────────────

  private async hasLeaveButton(page: Page): Promise<boolean> {
    for (const sel of ['.footer-button__button[aria-label="Leave"]', 'button:has-text("Leave")']) {
      try { if (await page.$(sel)) return true } catch {}
    }
    return false
  }

  private async waitForMeetingUI(page: Page): Promise<void> {
    const startMs = Date.now()
    const TIMEOUT_MS = 5 * 60 * 1000

    while (Date.now() - startMs < TIMEOUT_MS) {
      if (this.ended) return

      try {
        const isWaitingRoom = await page.evaluate(() => {
          const text = document.body.innerText || ''
          return (
            text.includes('Please wait, the meeting host will let you in soon') ||
            text.includes('Waiting for the host to start this meeting')
          )
        })

        if (await this.hasLeaveButton(page)) {
          console.log('[zoom-bot] Meeting UI detected (leave button present)')
          return
        }

        const elapsed = Math.round((Date.now() - startMs) / 1000)
        if (elapsed > 0 && elapsed % 15 === 0) {
          console.log(`[zoom-bot] ${isWaitingRoom ? 'In waiting room' : 'Waiting for meeting UI'} (${elapsed}s)...`)
        }
      } catch {}

      await page.waitForTimeout(1000).catch(() => {})
    }

    console.warn('[zoom-bot] Meeting UI not detected after 5 min')
    this.ended = true
  }

  private async tryOpenPeoplePanel(): Promise<void> {
    const page = this.page!
    // Check if panel already open
    const isOpen = await page.evaluate(() =>
      !!document.querySelector('.participants-item__display-name')
    )
    if (isOpen) return

    const selectors = [
      'button[aria-label^="open the participants" i]',
      'button[aria-label*="participant" i]',
      'button[aria-label="Participants"]',
      'button[title*="participant" i]',
      '.footer-button__participants-icon',
      '[class*="participants-button"]',
    ]
    for (const sel of selectors) {
      try {
        const btn = await page.$(sel)
        if (btn && await btn.isVisible()) {
          await btn.click()
          console.log(`[zoom-bot] Opened participants panel via "${sel}"`)
          await page.waitForTimeout(500)
          return
        }
      } catch {}
    }
  }

  private pollParticipantNames(opts: BotOptions): void {
    const page = this.page!
    const interval = setInterval(async () => {
      if (this.ended) { clearInterval(interval); return }
      try {
        // Keep the participants panel open
        await this.tryOpenPeoplePanel()

        const names = await page.evaluate(() => {
          const all = new Set<string>()
          // From participants panel (lists ALL attendees, even canvas-rendered ones)
          document.querySelectorAll('.participants-item__display-name').forEach(el => {
            const t = (el.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
            if (t) all.add(t)
          })
          // From video tiles (fallback, only catches visible tiles)
          document.querySelectorAll('.video-avatar__avatar-name').forEach(el => {
            const t = (el.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
            if (t) all.add(t)
          })
          return [...all]
        })

        const botName = (opts.displayName || 'NoteAI Recorder').toLowerCase()
        const unique = names.filter(
          n =>
            n.toLowerCase() !== botName &&
            !/^note/i.test(n) &&
            !/recorder/i.test(n) &&
            n.length >= 2 &&
            n.length <= 50
        )

        if (unique.length) {
          for (const name of unique) {
            opts.onSpeakerEvent?.({ type: 'participant_known', name })
          }
        }
      } catch {}
    }, 5000)
  }

  private watchForAlone(onEnded?: () => void): void {
    const page = this.page!
    const ALONE_MS = 3 * 60 * 1000
    const CHECK_MS = 30_000
    const GRACE_MS = 5 * 60 * 1000
    let aloneAt: number | null = null
    const joinedAt = Date.now()

    const iv = setInterval(async () => {
      if (this.ended) { clearInterval(iv); return }
      if (Date.now() - joinedAt < GRACE_MS) return

      try {
        const count = await page.evaluate(() => {
          const nameEls = document.querySelectorAll('.video-avatar__avatar-name')
          const names = Array.from(nameEls)
            .map(el => (el.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').trim())
            .filter(n => n && !/^note|recorder/i.test(n))
          return [...new Set(names)].length
        })

        if (count <= 1) {
          if (!aloneAt) { aloneAt = Date.now(); console.log('[zoom-bot] Alone — will leave in 3 min') }
          else if (Date.now() - aloneAt >= ALONE_MS) {
            console.log('[zoom-bot] Alone 3 min — leaving')
            clearInterval(iv)
            if (!this.ended) { this.ended = true; onEnded?.(); await this.stop() }
          }
        } else {
          aloneAt = null
        }
      } catch {}
    }, CHECK_MS)
  }

  private watchForEnd(onEnded?: () => void, onError?: (err: Error) => void): void {
    const page = this.page!
    const iv = setInterval(async () => {
      if (this.ended) { clearInterval(iv); return }
      try {
        // FIX: removed document.querySelector('.zm-modal-body') — that element
        // exists on the pre-join screen and was causing false end-of-meeting triggers.
        const isEnded = await page.evaluate(() => {
          const text = document.body.innerText || ''
          return (
            text.includes('This meeting has been ended by host') ||
            text.includes('The meeting has ended') ||
            text.includes('This meeting has ended')
          )
        })

        if (isEnded) {
          this.ended = true
          clearInterval(iv)
          console.log('[zoom-bot] Meeting ended (UI signal)')
          onEnded?.()
          await this.stop()
          return
        }

        const isBlocked = await page.evaluate(() => {
          const text = document.body.innerText || ''
          return (
            text.includes('Incorrect meeting password') ||
            text.includes('You cannot rejoin this meeting') ||
            text.includes('The host has removed you')
          )
        })

        if (isBlocked) {
          clearInterval(iv)
          onError?.(new Error("Can't join — invalid passcode or removed by host"))
          await this.stop()
        }
      } catch {}
    }, 3000)
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
        const leaveBtn = await page.$('.footer-button__button[aria-label="Leave"]')
        if (leaveBtn) {
          await leaveBtn.click()
          await page.waitForTimeout(500)
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
}