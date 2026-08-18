import { MeetBot } from './src/bot/meetBot';
import { createBotSession, forwardTrackAudio, setTrackName, forwardEvent } from './src/ws/ingestHandler';

const url = 'https://meet.google.com/wue-pzhr-kcn';
const code = 'livecheck-' + Math.floor(Date.now()/1000 % 100000);

(async () => {
  await createBotSession(code);
  console.log('[live] session', code, '— launching HEADLESS bot');
  const bot = new MeetBot();
  setTimeout(async () => { console.log('[live] 150s timeout — stopping'); try { await bot.stop(); } catch {} process.exit(0); }, 150000);

  await bot.start({
    meetingUrl: url,
    displayName: 'MeetMaster Recorder',
    onTrackAudio: (chunk, trackId) => forwardTrackAudio(code, chunk, trackId),
    onTrackInfo: (trackId, name) => setTrackName(code, trackId, name),
    onSpeakerEvent: (e) => forwardEvent(code, e),
    onJoined: () => console.log('[live] >>> JOINED (headless) — speak now; watch for [transcript] lines'),
    onError: (e) => console.log('[live] >>> onError:', e.message),
    onEnded: () => console.log('[live] >>> onEnded'),
  }).then(() => console.log('[live] start() resolved')).catch(e => console.log('[live] start THREW:', e.message));
})();
