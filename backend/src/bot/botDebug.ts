/**
 * Ground-truth page capture for a failed join step.
 *
 * Without this, an "unable to join" is opaque — we can't tell a stale selector
 * from a sign-in wall, a lobby that was never admitted, or a silent block.
 * Writes a screenshot + visible text under backend/bot-debug/ (next to
 * bot-diag.log) and echoes the first lines of on-screen text so the cause is
 * visible even without opening the file.
 */
import fs from 'fs'
import path from 'path'
import type { Page } from 'playwright'
import { diag } from '../services/diag'

export async function captureJoinDebug(page: Page, label: string, tag = 'bot'): Promise<void> {
  try {
    const dir = path.join(process.cwd(), 'bot-debug')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = path.join(dir, `${label}-${stamp}`)
    const url = page.url()
    const text = await page
      .evaluate(() => (document.body?.innerText || '').slice(0, 1500))
      .catch(() => '')
    try { await page.screenshot({ path: `${base}.png` }) } catch { /* headless race */ }
    try { fs.writeFileSync(`${base}.txt`, `url: ${url}\n\n${text}\n`) } catch { /* disk full */ }
    const firstLines = text
      .split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8).join(' | ')
    console.warn(`[${tag}] Debug capture (${label}) → ${base}.png  url=${url}`)
    if (firstLines) console.warn(`[${tag}] Page says: ${firstLines}`)
    diag(`JOIN-DEBUG ${label}: url=${url} :: ${firstLines}`)
  } catch (e) {
    console.warn(`[${tag}] captureJoinDebug failed:`, (e as Error).message)
  }
}
