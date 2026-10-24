import fs from 'fs'
import os from 'os'
import path from 'path'

// The bot only LISTENS. `--use-fake-ui-for-media-stream` alone just auto-clicks
// "Allow" — Chrome still opens the host's REAL microphone and webcam. On a dev
// laptop that meant the bot recorded the person sitting next to it: Meet's
// pre-join mic preview (and its post-join "you're speaking" meter) is a Web Audio
// source our injector taps, so the room's voice was transcribed before the bot
// was even admitted. Feeding Chrome a silent WAV + a black frame instead makes the
// bot's own mic/camera physically empty on every host (laptop or AWS alike).

const DIR = path.join(os.tmpdir(), 'noteai-fake-media')
const WAV = path.join(DIR, 'silence.wav')
const Y4M = path.join(DIR, 'black.y4m')

// 1s of 16 kHz mono 16-bit silence (Chrome loops the file).
function silentWav(): Buffer {
  const dataBytes = 16000 * 2
  const b = Buffer.alloc(44 + dataBytes)
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(dataBytes, 40)
  return b
}

// One black 640x480 I420 frame.
function blackY4m(): Buffer {
  const w = 640, h = 480
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F1:1 Ip A1:1 C420jpeg\nFRAME\n`)
  const y = Buffer.alloc(w * h, 16)             // black luma
  const uv = Buffer.alloc((w / 2) * (h / 2) * 2, 128) // neutral chroma (U+V)
  return Buffer.concat([header, y, uv])
}

/** Chrome flags that replace the real mic/camera with silent/black fake devices. */
export function fakeMediaArgs(): string[] {
  fs.mkdirSync(DIR, { recursive: true })
  if (!fs.existsSync(WAV)) fs.writeFileSync(WAV, silentWav())
  if (!fs.existsSync(Y4M)) fs.writeFileSync(Y4M, blackY4m())
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    `--use-file-for-fake-video-capture=${Y4M}`,
  ]
}
