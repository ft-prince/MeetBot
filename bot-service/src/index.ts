/**
 * Docker bot entry point.
 *
 * Reads environment variables, launches Playwright Chromium in the virtual
 * display provided by Xvfb, injects the audio injector, and streams captured
 * PCM back to the backend via the WsBridge.
 *
 * Environment variables:
 *   MEETING_URL      – full Google Meet / Zoom / Teams URL   (required)
 *   BACKEND_WS       – ws://host:8001/audio?meetingId=...    (required)
 *   DISPLAY_NAME     – bot name shown in the meeting         (default: NoteAI Recorder)
 *   DISPLAY          – X11 display exported by Xvfb          (default: :99)
 *   CHROMIUM_PATH    – override Chromium executable path
 *   BOT_JOIN_TIMEOUT – seconds to wait for meeting UI        (default: 120)
 */

import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { WsBridge } from './wsBridge';

const MEETING_URL   = process.env.MEETING_URL!;
const BACKEND_WS    = process.env.BACKEND_WS!;
const DISPLAY_NAME  = process.env.DISPLAY_NAME || 'NoteAI Recorder';
const DISPLAY       = process.env.DISPLAY || ':99';
const JOIN_TIMEOUT  = parseInt(process.env.BOT_JOIN_TIMEOUT || '120', 10) * 1000;
const MAX_DURATION  = 4 * 60 * 60 * 1000; // 4 h safety cap

if (!MEETING_URL) { console.error('[bot] MEETING_URL is required'); process.exit(1); }
if (!BACKEND_WS)  { console.error('[bot] BACKEND_WS is required');  process.exit(1); }

function detectPlatform(url: string): 'meet' | 'zoom' | 'teams' {
  if (/teams\.microsoft\.com|teams\.live\.com/i.test(url)) return 'teams';
  if (/zoom\.us|zoomgov\.com/i.test(url)) return 'zoom';
  return 'meet';
}

// Chrome args adapted for a headless Linux container with Xvfb + PulseAudio.
function buildChromeArgs(): string[] {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--use-fake-ui-for-media-stream',        // auto-accept mic/camera prompts
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--disable-infobars',
    '--disable-default-apps',
    '--window-size=1280,800',
    '--ignore-certificate-errors',
    // PulseAudio provides real audio — no fake device needed
  ];
}

async function setupBridgeInPage(page: Page, bridge: WsBridge): Promise<void> {
  await page.exposeFunction('noteAISendTrackAudio', (samples: number[], trackId: string) => {
    const chunk = Buffer.from(new Int16Array(samples).buffer);
    bridge.sendAudio(chunk, trackId);
  });

  await page.exposeFunction('noteAISendTrackInfo', (trackId: string, name: string) => {
    bridge.sendTrackInfo(trackId, name);
  });

  await page.exposeFunction('noteAISendEvent', (json: string) => {
    try { bridge.sendEvent(JSON.parse(json)); } catch {}
  });
}

async function injectAudio(page: Page, platform: 'meet' | 'zoom' | 'teams'): Promise<void> {
  const injectorFile = platform === 'teams'
    ? 'teamsAudioInjector.js'
    : platform === 'zoom'
      ? 'zoomAudioInjector.js'
      : 'audioInjector.js';

  // Injector lives alongside the compiled bot source at runtime
  const injectorPath = path.resolve(__dirname, '../../backend/src/bot', injectorFile);
  await page.addInitScript({ path: injectorPath });
}

// ── Platform-specific join flows ───────────────────────────────────────────────

async function joinGoogleMeet(page: Page): Promise<void> {
  await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });

  // Fill display name (locale-agnostic: match the single text input in pre-join)
  try {
    const nameInput = await page.waitForSelector(
      'input[jsname][type="text"], input[type="text"]:not([aria-hidden="true"])',
      { timeout: 10000 }
    );
    await nameInput.fill(DISPLAY_NAME);
  } catch { /* name field may not appear (already signed in) */ }

  // Mute mic and camera before joining
  for (const aria of ['Turn off microphone', 'Turn off camera']) {
    try {
      const btn = page.locator(`button[aria-label*="${aria}"]`).first();
      if (await btn.isVisible({ timeout: 2000 })) await btn.click();
    } catch {}
  }

  // Click the join CTA — locale-agnostic selector from Vexa
  const joinBtn = await page.waitForSelector(
    'button[jsname]:not([aria-label]):has(span)',
    { timeout: 30000 }
  );
  await joinBtn.click();

  // Wait until inside the meeting
  await page.waitForSelector('[data-participant-id], [data-self-name], [data-ssrc]', {
    timeout: JOIN_TIMEOUT,
  });
  console.log('[bot] Joined Google Meet');
}

async function joinZoom(page: Page): Promise<void> {
  await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });

  // Accept cookies / overlays
  try {
    await page.locator('button:has-text("I Agree"), button:has-text("Accept")').first().click({ timeout: 3000 });
  } catch {}

  // Display name
  try {
    const nameInput = await page.waitForSelector('input[placeholder*="name" i], input#inputname', { timeout: 10000 });
    await nameInput.fill(DISPLAY_NAME);
  } catch {}

  // Join
  const joinBtn = await page.waitForSelector(
    'button:has-text("Join"), button:has-text("Launch Meeting"), a:has-text("Join")',
    { timeout: 30000 }
  );
  await joinBtn.click();

  await page.waitForSelector('.meeting-client-inner, .zmwebsdk-MuiBox-root', {
    timeout: JOIN_TIMEOUT,
  });
  console.log('[bot] Joined Zoom');
}

async function joinTeams(page: Page): Promise<void> {
  await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });

  // Accept cookies
  try {
    await page.locator('button:has-text("Accept"), button[id*="cookie"]').first().click({ timeout: 3000 });
  } catch {}

  // "Continue on this browser" if shown
  try {
    await page.locator('button:has-text("Continue on this browser")').click({ timeout: 5000 });
  } catch {}

  // Display name
  try {
    const nameInput = await page.waitForSelector(
      'input[placeholder*="name" i], input[type="text"]',
      { timeout: 10000 }
    );
    await nameInput.fill(DISPLAY_NAME);
  } catch {}

  // Mute mic/camera
  for (const aria of ['Turn off microphone', 'Turn off camera']) {
    try {
      const btn = page.locator(`button[aria-label*="${aria}"]`).first();
      if (await btn.isVisible({ timeout: 2000 })) await btn.click();
    } catch {}
  }

  // Join button
  const joinBtn = await page.waitForSelector(
    'button:has-text("Join now"), button:has-text("Join")',
    { timeout: 30000 }
  );
  await joinBtn.click();

  // Wait until admitted
  await page.waitForSelector(
    'button[aria-label*="Leave"], button[id="hangup-button"], [data-tid*="hangup"]',
    { timeout: JOIN_TIMEOUT }
  );
  console.log('[bot] Joined Teams');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const platform = detectPlatform(MEETING_URL);
  console.log(`[bot] Platform: ${platform} | Meeting: ${MEETING_URL}`);

  const bridge = new WsBridge(BACKEND_WS);
  await bridge.connect();

  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless: false,
    args: buildChromeArgs(),
    ignoreDefaultArgs: ['--enable-automation'],
    env: { ...process.env, DISPLAY },
  };

  // Use system Chrome if available (more compatible with meeting web apps)
  const chromiumPath = process.env.CHROMIUM_PATH;
  if (chromiumPath) launchOpts.executablePath = chromiumPath;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch(launchOpts);
    context = await browser.newContext({
      permissions: ['microphone', 'camera'],
      userAgent: [
        'Mozilla/5.0 (X11; Linux x86_64)',
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        'Chrome/120.0.0.0 Safari/537.36',
      ].join(' '),
    });

    const page = await context.newPage();

    await setupBridgeInPage(page, bridge);
    await injectAudio(page, platform);

    bridge.sendEvent({ type: 'bot_joining', meetingUrl: MEETING_URL });

    if (platform === 'meet')  await joinGoogleMeet(page);
    if (platform === 'zoom')  await joinZoom(page);
    if (platform === 'teams') await joinTeams(page);

    bridge.sendEvent({ type: 'bot.joined' });
    console.log('[bot] Recording started');

    // Safety cap — leave after MAX_DURATION regardless
    const maxTimer = setTimeout(async () => {
      console.log('[bot] Max duration reached — leaving');
      await page.close().catch(() => {});
    }, MAX_DURATION);

    // Block until the page closes (meeting ended / bot removed)
    await page.waitForEvent('close', { timeout: MAX_DURATION });
    clearTimeout(maxTimer);

  } finally {
    bridge.sendEvent({ type: 'meeting.ended' });
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    bridge.close();
    console.log('[bot] Exiting');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[bot] Fatal error:', err);
  process.exit(1);
});
