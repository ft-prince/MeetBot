/**
 * Proves the bot can't hear the room: launches Chrome exactly like the bots do,
 * opens the microphone, plays speech out of the speakers with macOS `say`, and
 * measures what the mic captured.
 *   OLD flags (control): real mic → non-zero level (only on a host with a mic)
 *   NEW flags (bots):    fake silent device → must be 0.0000
 * Usage: npx tsx scripts/test-bot-mic-isolation.ts   (exit 1 if the bot hears audio)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fakeMediaArgs } from '../src/bot/fakeMedia';
async function probe(label: string, args: string[]): Promise<{ label: string; peakRms: number }> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...args] });
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  await page.goto('https://example.com');
  const speaker = spawn('say', ['-v', 'Aman', 'Testing the microphone, one two three, hello hello, this should be heard by a real mic.']);
  const result = await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const label = s.getAudioTracks()[0].label;
    const ctx = new AudioContext(); const a = ctx.createAnalyser(); a.fftSize = 2048;
    ctx.createMediaStreamSource(s).connect(a);
    const buf = new Float32Array(a.fftSize); let peak = 0;
    const end = Date.now() + 4000;
    while (Date.now() < end) { a.getFloatTimeDomainData(buf); let sum = 0; for (const v of buf) sum += v * v; peak = Math.max(peak, Math.sqrt(sum / buf.length)); await new Promise(r => setTimeout(r, 50)); }
    return { label, peakRms: peak };
  });
  speaker.kill();
  console.log(`${label.padEnd(28)} device="${result.label}"  peakRMS=${result.peakRms.toFixed(4)}`);
  await browser.close();
  return result;
}
(async () => {
  await probe('OLD flags (fake-ui only)', ['--use-fake-ui-for-media-stream']);
  const bot = await probe('NEW flags (fakeMediaArgs)', fakeMediaArgs());
  const ok = bot.label.startsWith('Fake') && bot.peakRms === 0;
  console.log(ok ? 'PASS  bot mic is a silent fake device' : 'FAIL  bot can hear the room');
  process.exit(ok ? 0 : 1);
})();
