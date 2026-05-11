const BACKEND    = 'http://localhost:3001'
const BACKEND_WS = 'ws://localhost:3001'

// meetings: Map<meetingId, { ws, segments, speakerColors, colorIdx }>
const meetings = new Map()

const COLORS = [
  { bg: '#312e81', text: '#a5b4fc', border: '#6366f1' },
  { bg: '#1e3a5f', text: '#93c5fd', border: '#3b82f6' },
  { bg: '#14532d', text: '#86efac', border: '#22c55e' },
  { bg: '#7f1d1d', text: '#fca5a5', border: '#ef4444' },
  { bg: '#713f12', text: '#fcd34d', border: '#f59e0b' },
  { bg: '#4a044e', text: '#e879f9', border: '#a21caf' },
]

function getColor(mid, name) {
  const m = meetings.get(mid)
  if (!m) return COLORS[0]
  if (!m.speakerColors[name]) {
    m.speakerColors[name] = COLORS[m.colorIdx % COLORS.length]
    m.colorIdx++
  }
  return m.speakerColors[name]
}

function initials(name) {
  if (!name || name.startsWith('SPEAKER') || name.length < 3 && name === name.toUpperCase()) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Join ─────────────────────────────────────────────────────────

async function joinMeeting() {
  const input = document.getElementById('meetUrl')
  const url = input.value.trim()
  if (!url) return

  const btn = document.getElementById('btnJoin')
  btn.disabled = true
  btn.textContent = 'Launching…'

  try {
    const res = await fetch(`${BACKEND}/api/meetings/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingUrl: url }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed') }

    const { meetingId } = await res.json()
    input.value = ''
    createMeetingCard(meetingId, url)
    connectWS(meetingId)
  } catch (err) {
    alert('Error: ' + err.message)
  } finally {
    btn.disabled = false
    btn.textContent = '+ Start Recording'
  }
}

// ── Card creation ─────────────────────────────────────────────────

function createMeetingCard(mid, url) {
  document.getElementById('emptyHome')?.remove()

  meetings.set(mid, { ws: null, segments: [], speakerColors: {}, colorIdx: 0 })

  const card = document.createElement('div')
  card.className = 'meeting-card'
  card.id = `card-${mid}`
  card.innerHTML = `
    <div class="card-header">
      <span class="dot loading" id="dot-${mid}"></span>
      <span class="card-id">${esc(mid)}</span>
      <span class="card-status" id="status-${mid}">Bot joining…</span>
    </div>
    <div class="card-live" id="live-${mid}">
      <span class="live-speaker" id="live-spk-${mid}" style="color:#334155">—</span>
      <span class="live-text"   id="live-txt-${mid}"></span>
    </div>
    <div class="card-transcript" id="tx-${mid}">
      <div class="card-empty">Waiting for speech…</div>
    </div>
    <div class="card-toolbar">
      <button class="btn-sm btn-red"    onclick="stopMeeting('${mid}')">⏹ Stop &amp; Leave</button>
      <button class="btn-sm btn-orange" onclick="openSwap('${mid}')">🔄 Swap Speakers</button>
      <button class="btn-sm btn-gray"   onclick="copyTranscript('${mid}')">📋 Copy</button>
      <button class="btn-sm btn-gray"   onclick="exportTranscript('${mid}')">⬇ Export</button>
    </div>
  `
  document.getElementById('meetings').appendChild(card)
}

function removeCard(mid) {
  document.getElementById(`card-${mid}`)?.remove()
  meetings.delete(mid)
  if (document.getElementById('meetings').children.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-home'
    empty.id = 'emptyHome'
    empty.innerHTML = '<span class="icon">🎙</span><p>Paste a meeting link above to start recording</p>'
    document.getElementById('meetings').appendChild(empty)
  }
}

// ── Status helpers ────────────────────────────────────────────────

function setStatus(mid, state, text) {
  const dot = document.getElementById(`dot-${mid}`)
  const st  = document.getElementById(`status-${mid}`)
  if (dot) dot.className = 'dot ' + (state || '')
  if (st)  st.textContent = text
}

// ── WebSocket ────────────────────────────────────────────────────

function connectWS(mid) {
  const ws = new WebSocket(`${BACKEND_WS}/panel?meetingId=${mid}`)
  meetings.get(mid).ws = ws

  ws.onopen  = () => setStatus(mid, 'loading', 'Bot joining meeting…')
  ws.onclose = () => setStatus(mid, '', 'Disconnected')
  ws.onerror = () => setStatus(mid, 'error', 'Connection error')

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)

    if (msg.type === 'bot.joined') {
      setStatus(mid, 'active', 'Live — transcribing')
    }
    if (msg.type === 'meeting.ended') {
      setStatus(mid, '', 'Meeting ended')
      ws.close()
    }
    if (msg.type === 'transcript.interim') {
      updateLive(mid, msg)
    }
    if (msg.type === 'transcript.final') {
      appendSegment(mid, msg)
      updateLive(mid, null)
    }
    if (msg.type === 'speaker.identified') {
      relabelSegments(mid, msg.label, msg.name)
    }
  }
}

// ── Live caption ─────────────────────────────────────────────────

function updateLive(mid, msg) {
  const spkEl = document.getElementById(`live-spk-${mid}`)
  const txtEl = document.getElementById(`live-txt-${mid}`)
  if (!spkEl || !txtEl) return

  if (!msg) {
    spkEl.textContent = '—'; spkEl.style.color = '#334155'
    txtEl.textContent = ''; return
  }
  const name = msg.speakerName || msg.speakerLabel || '?'
  const c = getColor(mid, name)
  spkEl.textContent = name; spkEl.style.color = c.text
  txtEl.textContent = msg.text
}

// ── Transcript ────────────────────────────────────────────────────

function appendSegment(mid, msg) {
  const container = document.getElementById(`tx-${mid}`)
  if (!container) return
  container.querySelector('.card-empty')?.remove()

  const m = meetings.get(mid)
  const name = msg.speakerName || msg.speakerLabel || '?'
  const c = getColor(mid, name)

  m.segments.push({
    id: msg.segmentId, speakerLabel: msg.speakerLabel,
    speakerName: msg.speakerName, text: msg.text, startMs: msg.startMs || 0,
  })

  const el = document.createElement('div')
  el.className = 'segment'
  el.dataset.id    = msg.segmentId
  el.dataset.label = msg.speakerLabel || ''
  el.dataset.mid   = mid
  el.style.borderLeftColor = c.border
  el.innerHTML = `
    <div class="seg-meta">
      <div class="avatar" style="background:${c.bg};color:${c.text}">${esc(initials(name))}</div>
      <span class="seg-name" style="color:${c.text}">${esc(name)}</span>
      <span class="seg-time">${fmtTime(msg.startMs || 0)}</span>
    </div>
    <div class="seg-text">${esc(msg.text)}</div>
  `
  container.appendChild(el)
  container.scrollTop = container.scrollHeight
}

function relabelSegments(mid, label, name) {
  const m = meetings.get(mid)
  if (!m) return
  const c = getColor(mid, name)
  document.querySelectorAll(`[data-label="${label}"][data-mid="${mid}"]`).forEach(el => {
    el.style.borderLeftColor = c.border
    const av = el.querySelector('.avatar')
    const nm = el.querySelector('.seg-name')
    if (av) { av.textContent = initials(name); av.style.background = c.bg; av.style.color = c.text }
    if (nm) { nm.textContent = name; nm.style.color = c.text }
  })
  m.segments.filter(s => s.speakerLabel === label).forEach(s => s.speakerName = name)
}

// ── Actions ───────────────────────────────────────────────────────

async function stopMeeting(mid) {
  const m = meetings.get(mid)
  if (!m) return
  await fetch(`${BACKEND}/api/meetings/${mid}/stop`, { method: 'POST' })
  m.ws?.close()
  removeCard(mid)
}

function copyTranscript(mid) {
  const m = meetings.get(mid)
  if (!m) return
  const text = m.segments.map(s =>
    `[${fmtTime(s.startMs)}] ${s.speakerName || s.speakerLabel || '?'}: ${s.text}`
  ).join('\n')
  navigator.clipboard.writeText(text)
}

function exportTranscript(mid) {
  const m = meetings.get(mid)
  if (!m) return
  const text = m.segments.map(s =>
    `[${fmtTime(s.startMs)}] ${s.speakerName || s.speakerLabel || '?'}: ${s.text}`
  ).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = `transcript-${mid}.txt`
  a.click()
}

// ── Swap Speakers ─────────────────────────────────────────────────

let swapMid = null

function openSwap(mid) {
  const m = meetings.get(mid)
  if (!m) return
  swapMid = mid

  // Collect distinct speaker names/labels in this meeting
  const speakers = [...new Set(m.segments.map(s => s.speakerName || s.speakerLabel || '?'))]
  if (speakers.length < 2) { alert('Need at least 2 speakers to swap.'); return }

  const selA = document.getElementById('swapA')
  const selB = document.getElementById('swapB')
  selA.innerHTML = speakers.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')
  selB.innerHTML = speakers.map((s, i) => `<option value="${esc(s)}" ${i===1?'selected':''}>${esc(s)}</option>`).join('')

  document.getElementById('swapModal').classList.add('open')
}

function closeSwap() {
  document.getElementById('swapModal').classList.remove('open')
  swapMid = null
}

function applySwap() {
  if (!swapMid) return
  const nameA = document.getElementById('swapA').value
  const nameB = document.getElementById('swapB').value
  if (nameA === nameB) { closeSwap(); return }

  const m = meetings.get(swapMid)
  if (!m) return

  // Swap all segment assignments
  const TEMP = '__SWAP_TEMP__'
  m.segments.forEach(s => {
    const n = s.speakerName || s.speakerLabel || '?'
    if (n === nameA) s._swap = 'A'
    else if (n === nameB) s._swap = 'B'
  })
  m.segments.forEach(s => {
    if (s._swap === 'A') { s.speakerName = nameB; s.speakerLabel = nameB }
    else if (s._swap === 'B') { s.speakerName = nameA; s.speakerLabel = nameA }
    delete s._swap
  })

  // Swap color assignments
  const cA = m.speakerColors[nameA]
  const cB = m.speakerColors[nameB]
  if (cA) m.speakerColors[nameB] = cA
  if (cB) m.speakerColors[nameA] = cB

  // Re-render all segments in this meeting's card
  const container = document.getElementById(`tx-${swapMid}`)
  if (container) {
    container.innerHTML = ''
    m.segments.forEach(s => appendSegmentDirect(swapMid, s, container))
  }

  closeSwap()
}

function appendSegmentDirect(mid, s, container) {
  const name = s.speakerName || s.speakerLabel || '?'
  const c = getColor(mid, name)
  const el = document.createElement('div')
  el.className = 'segment'
  el.dataset.id    = s.id
  el.dataset.label = s.speakerLabel || ''
  el.dataset.mid   = mid
  el.style.borderLeftColor = c.border
  el.innerHTML = `
    <div class="seg-meta">
      <div class="avatar" style="background:${c.bg};color:${c.text}">${esc(initials(name))}</div>
      <span class="seg-name" style="color:${c.text}">${esc(name)}</span>
      <span class="seg-time">${fmtTime(s.startMs || 0)}</span>
    </div>
    <div class="seg-text">${esc(s.text)}</div>
  `
  container.appendChild(el)
}

// Enter key on input
document.getElementById('meetUrl').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinMeeting()
})
