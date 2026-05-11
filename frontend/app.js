const BACKEND    = 'http://localhost:8001'
const BACKEND_WS = 'ws://localhost:8001'

const meetings = new Map()

// Speaker colours — light theme palette
const COLORS = [
  { bg:'#EDE9FE', text:'#5B21B6', border:'#8B5CF6' },
  { bg:'#D1FAE5', text:'#065F46', border:'#10B981' },
  { bg:'#FEF3C7', text:'#92400E', border:'#F59E0B' },
  { bg:'#FCE7F3', text:'#9D174D', border:'#EC4899' },
  { bg:'#DBEAFE', text:'#1E40AF', border:'#3B82F6' },
  { bg:'#FEE2E2', text:'#991B1B', border:'#EF4444' },
]

let currentUser = null

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadUser()
  await loadCalendarEvents()
  await loadPastMeetings()
  document.getElementById('meetUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinMeeting()
  })
  // check for auth error in URL
  const params = new URLSearchParams(location.search)
  if (params.get('auth_error')) {
    alert('Google sign-in failed: ' + params.get('auth_error'))
    history.replaceState({}, '', '/')
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function loadUser() {
  try {
    const res = await fetch(`${BACKEND}/auth/me`, { credentials:'include' })
    const data = await res.json()
    currentUser = data.user
  } catch {}
  renderSidebarFooter()
}

function renderSidebarFooter() {
  const footer = document.getElementById('sidebarFooter')
  if (!currentUser) {
    footer.innerHTML = `<a href="/auth/google" class="connect-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Connect Google
    </a>`
    return
  }
  const initials = currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  footer.innerHTML = `
    <div class="user-row">
      <div class="user-avatar">${currentUser.picture ? `<img src="${esc(currentUser.picture)}" />` : initials}</div>
      <div class="user-info">
        <div class="user-name">${esc(currentUser.name)}</div>
        <div class="user-email">${esc(currentUser.email)}</div>
      </div>
      <button class="btn-logout" onclick="logout()">Out</button>
    </div>`
}

async function logout() {
  await fetch(`${BACKEND}/auth/logout`, { method:'POST', credentials:'include' })
  currentUser = null
  renderSidebarFooter()
  document.getElementById('calContent').innerHTML = `
    <div class="alert alert-info"><strong>Connect your Google account</strong> to sync upcoming meetings.</div>`
}

// ── Navigation ────────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  live:     ['Live Recording',   'Real-time transcription with speaker identification'],
  calendar: ['Calendar',         'Upcoming meetings from Google Calendar'],
  past:     ['Past Meetings',    'Completed meetings with AI summaries'],
}

function showPage(name, el) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'))
  if (el) el.classList.add('active')
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById(`page-${name}`)?.classList.add('active')
  const [title, sub] = PAGE_TITLES[name] || ['NoteAI','']
  document.getElementById('topbarTitle').textContent = title
  document.getElementById('topbarSub').textContent = sub
  if (name === 'past') loadPastMeetings()
  if (name === 'calendar') loadCalendarEvents()
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getColor(mid, name) {
  const m = meetings.get(mid)
  if (!m) return COLORS[0]
  if (!m.speakerColors[name]) { m.speakerColors[name] = COLORS[m.colorIdx % COLORS.length]; m.colorIdx++ }
  return m.speakerColors[name]
}
function initials(name) {
  if (!name || name.startsWith('SPEAKER') || (name.length < 3 && name === name.toUpperCase())) return '?'
  return name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
}
function fmtTime(ms) { const s=Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function fmtDate(dt) { return new Date(dt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) }
function fmtTimeOfDay(dt) { return new Date(dt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}) }
function fmtDuration(ms) { if(!ms) return '—'; const m=Math.floor(ms/60000); return m<60?`${m}m`:`${Math.floor(m/60)}h ${m%60}m` }

// ── Join ──────────────────────────────────────────────────────────────────────
async function joinMeeting() {
  const input = document.getElementById('meetUrl')
  const url = input.value.trim()
  if (!url) return
  const btn = document.getElementById('btnJoin')
  btn.disabled = true; btn.textContent = 'Launching…'
  try {
    const res = await fetch(`${BACKEND}/api/meetings/join`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({ meetingUrl:url }),
    })
    if (!res.ok) { const e=await res.json(); throw new Error(e.error||'Failed') }
    const { meetingId } = await res.json()
    input.value = ''
    createMeetingCard(meetingId)
    connectWS(meetingId)
    updateLiveBadge()
  } catch(err) { alert('Error: '+err.message) }
  finally { btn.disabled=false; btn.textContent='+ Start Recording' }
}

// ── Cards ─────────────────────────────────────────────────────────────────────
function createMeetingCard(mid) {
  document.getElementById('emptyHome')?.remove()
  meetings.set(mid, { ws:null, segments:[], speakerColors:{}, colorIdx:0 })

  const card = document.createElement('div')
  card.className = 'meeting-card'; card.id = `card-${mid}`
  card.innerHTML = `
    <div class="mc-header">
      <span class="dot loading" id="dot-${mid}"></span>
      <span class="mc-code">${esc(mid)}</span>
      <span class="mc-status" id="status-${mid}">Bot joining…</span>
    </div>
    <div class="mc-live" id="live-${mid}">
      <span class="live-speaker" id="live-spk-${mid}">—</span>
      <span class="live-text" id="live-txt-${mid}"></span>
    </div>
    <div class="mc-transcript" id="tx-${mid}">
      <div class="mc-empty">Waiting for speech…</div>
    </div>
    <div class="mc-summary" id="sum-${mid}"></div>
    <div class="mc-toolbar">
      <button class="btn btn-danger btn-sm" onclick="stopMeeting('${mid}')">⏹ Stop & Leave</button>
      <button class="btn btn-secondary btn-sm" onclick="openSwap('${mid}')">🔄 Swap Speakers</button>
      <button class="btn btn-secondary btn-sm" onclick="copyTranscript('${mid}')">📋 Copy</button>
      <button class="btn btn-secondary btn-sm" onclick="exportTranscript('${mid}')">⬇ Export</button>
    </div>`
  document.getElementById('meetings').appendChild(card)
}

function removeCard(mid) {
  document.getElementById(`card-${mid}`)?.remove()
  meetings.delete(mid)
  updateLiveBadge()
  if (!document.getElementById('meetings').querySelector('.meeting-card')) {
    const e = document.createElement('div')
    e.className='empty-state'; e.id='emptyHome'; e.style.gridColumn='1/-1'
    e.innerHTML='<div class="icon">🎙</div><p>No active recordings. Paste a Meet link above to start.</p>'
    document.getElementById('meetings').appendChild(e)
  }
}

function setStatus(mid, state, text) {
  const dot=document.getElementById(`dot-${mid}`)
  const st=document.getElementById(`status-${mid}`)
  if (dot) dot.className='dot '+(state||'')
  if (st) st.textContent=text
}

function updateLiveBadge() {
  const count = meetings.size
  const badge = document.getElementById('liveBadge')
  badge.style.display = count ? '' : 'none'
  badge.textContent = count
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS(mid) {
  const ws = new WebSocket(`${BACKEND_WS}/panel?meetingId=${mid}`)
  meetings.get(mid).ws = ws
  ws.onopen  = () => setStatus(mid,'loading','Bot joining meeting…')
  ws.onclose = () => setStatus(mid,'','Disconnected')
  ws.onerror = () => setStatus(mid,'error','Connection error')
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type==='bot.joined')        setStatus(mid,'active','● Live — transcribing')
    if (msg.type==='meeting.ended') {
      setStatus(mid,'','Meeting ended — generating summary…')
      ws.close()
      pollSummary(mid)
    }
    if (msg.type==='transcript.interim') updateLive(mid,msg)
    if (msg.type==='transcript.final')   { appendSegment(mid,msg); updateLive(mid,null) }
    if (msg.type==='speaker.identified') relabelSegments(mid,msg.label,msg.name)
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
async function pollSummary(mid, attempts=0) {
  if (attempts > 20) return
  try {
    const res = await fetch(`${BACKEND}/api/meetings/${mid}/summary`, { credentials:'include' })
    if (!res.ok) return
    const data = await res.json()
    if (data.summary) {
      showSummaryInCard(mid, data.summary, data.keyInsights||[])
      setStatus(mid,'','Meeting ended')
      loadPastMeetings()
      return
    }
  } catch {}
  setTimeout(() => pollSummary(mid, attempts+1), 6000)
}

function showSummaryInCard(mid, summary, insights) {
  const el = document.getElementById(`sum-${mid}`)
  if (!el) return
  el.innerHTML = `
    <div class="sum-title">🤖 AI Summary</div>
    <div class="sum-text">${esc(summary)}</div>
    ${insights.length ? `
      <div class="sum-title" style="margin-top:6px">Key Insights</div>
      <ul class="sum-insights">${insights.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>` : ''}
  `
  el.classList.add('visible')
}

// ── Live caption ──────────────────────────────────────────────────────────────
function updateLive(mid, msg) {
  const spkEl=document.getElementById(`live-spk-${mid}`)
  const txtEl=document.getElementById(`live-txt-${mid}`)
  if (!spkEl||!txtEl) return
  if (!msg) { spkEl.textContent='—'; spkEl.style.color=''; txtEl.textContent=''; return }
  const name = msg.speakerName||msg.speakerLabel||'?'
  const c = getColor(mid,name)
  spkEl.textContent=name; spkEl.style.color=c.text
  txtEl.textContent=msg.text
}

// ── Transcript ────────────────────────────────────────────────────────────────
function appendSegment(mid, msg) {
  const container=document.getElementById(`tx-${mid}`)
  if (!container) return
  container.querySelector('.mc-empty')?.remove()
  const m=meetings.get(mid)
  const name=msg.speakerName||msg.speakerLabel||'?'
  const c=getColor(mid,name)
  m.segments.push({ id:msg.segmentId, speakerLabel:msg.speakerLabel, speakerName:msg.speakerName, text:msg.text, startMs:msg.startMs||0 })
  const el=document.createElement('div')
  el.className='segment'
  el.dataset.id=msg.segmentId; el.dataset.label=msg.speakerLabel||''; el.dataset.mid=mid
  el.style.borderLeftColor=c.border
  el.innerHTML=`
    <div class="seg-meta">
      <div class="avatar" style="background:${c.bg};color:${c.text}">${esc(initials(name))}</div>
      <span class="seg-name" style="color:${c.text}">${esc(name)}</span>
      <span class="seg-time">${fmtTime(msg.startMs||0)}</span>
    </div>
    <div class="seg-text">${esc(msg.text)}</div>`
  container.appendChild(el)
  container.scrollTop=container.scrollHeight
}

function relabelSegments(mid, label, name) {
  const m=meetings.get(mid); if (!m) return
  const c=getColor(mid,name)
  document.querySelectorAll(`[data-label="${label}"][data-mid="${mid}"]`).forEach(el=>{
    el.style.borderLeftColor=c.border
    const av=el.querySelector('.avatar'), nm=el.querySelector('.seg-name')
    if (av){av.textContent=initials(name);av.style.background=c.bg;av.style.color=c.text}
    if (nm){nm.textContent=name;nm.style.color=c.text}
  })
  m.segments.filter(s=>s.speakerLabel===label).forEach(s=>s.speakerName=name)
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function stopMeeting(mid) {
  const m=meetings.get(mid); if (!m) return
  await fetch(`${BACKEND}/api/meetings/${mid}/stop`,{method:'POST',credentials:'include'})
  m.ws?.close(); removeCard(mid)
}

function copyTranscript(mid) {
  const m=meetings.get(mid); if (!m) return
  const text=m.segments.map(s=>`[${fmtTime(s.startMs)}] ${s.speakerName||s.speakerLabel||'?'}: ${s.text}`).join('\n')
  navigator.clipboard.writeText(text).then(()=>alert('Transcript copied!'))
}

function exportTranscript(mid) {
  const m=meetings.get(mid); if (!m) return
  const text=m.segments.map(s=>`[${fmtTime(s.startMs)}] ${s.speakerName||s.speakerLabel||'?'}: ${s.text}`).join('\n')
  const a=document.createElement('a')
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}))
  a.download=`transcript-${mid}.txt`; a.click()
}

// ── Calendar ──────────────────────────────────────────────────────────────────
async function syncCalendar() {
  if (!currentUser) { alert('Connect your Google account first.'); return }
  const btn=document.getElementById('btnSync')
  btn.disabled=true; btn.textContent='Syncing…'
  try {
    const res=await fetch(`${BACKEND}/api/calendar/sync`,{method:'POST',credentials:'include'})
    if (!res.ok) throw new Error((await res.json()).error||'Sync failed')
    const data=await res.json()
    renderCalendarEvents(data.events)
    btn.textContent=`✓ ${data.synced} synced`
    setTimeout(()=>{btn.textContent='🔄 Sync Calendar';btn.disabled=false},2500)
  } catch(err) {
    alert('Sync error: '+err.message)
    btn.disabled=false; btn.textContent='🔄 Sync Calendar'
  }
}

async function loadCalendarEvents() {
  if (!currentUser) return
  try {
    const res=await fetch(`${BACKEND}/api/calendar/events`,{credentials:'include'})
    if (!res.ok) return
    const {events}=await res.json()
    renderCalendarEvents(events)
  } catch {}
}

function renderCalendarEvents(events) {
  const el=document.getElementById('calContent')
  if (!currentUser) {
    el.innerHTML=`<div class="alert alert-info"><strong>Connect your Google account</strong> to sync upcoming meetings and enable auto-join.</div>`
    return
  }
  if (!events||!events.length) {
    el.innerHTML=`
      <div class="alert alert-info" style="margin-bottom:1rem">No upcoming Google Meet meetings found in the next 25 days.</div>
      <button class="btn btn-primary btn-sm" onclick="syncCalendar()">🔄 Sync Calendar Now</button>`
    return
  }

  el.innerHTML=`<div style="display:flex;flex-direction:column;gap:.75rem">${events.map(ev=>{
    const start=new Date(ev.startTime)
    const attendeeStr=(ev.attendees||[]).slice(0,3).map(a=>a.name||a.email).join(', ')
      +((ev.attendees||[]).length>3?` +${ev.attendees.length-3} more`:'')
    return `
      <div class="cal-event" id="calev-${esc(ev.id)}">
        <div class="cal-time-block">
          <div class="cal-date">${fmtDate(start)}</div>
          <div class="cal-time">${fmtTimeOfDay(start)}</div>
        </div>
        <div class="cal-info">
          <div class="cal-title">${esc(ev.title)}</div>
          <div class="cal-attendees">👥 ${esc(attendeeStr||'No attendees')}</div>
        </div>
        <div class="cal-actions">
          <div class="autojoin-wrap">
            <span>Auto-join</span>
            <button class="toggle ${ev.autoJoin?'on':''}" id="tog-${esc(ev.id)}"
              onclick="toggleAutoJoin('${esc(ev.id)}',this)"></button>
          </div>
          ${ev.meetingId
            ? `<span class="pill pill-live">● Live</span>`
            : `<button class="btn btn-success btn-sm" onclick="joinFromCalendar('${esc(ev.meetUrl)}')">▶ Join</button>`}
        </div>
      </div>`
  }).join('')}</div>`
}

async function toggleAutoJoin(eventId, btn) {
  const isOn=btn.classList.contains('on')
  btn.classList.toggle('on',!isOn)
  try {
    await fetch(`${BACKEND}/api/calendar/events/${eventId}/auto-join`,{
      method:'PATCH', headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({autoJoin:!isOn}),
    })
  } catch { btn.classList.toggle('on',isOn) }
}

async function joinFromCalendar(meetUrl) {
  showPage('live', document.querySelectorAll('.nav-link')[0])
  document.getElementById('meetUrl').value=meetUrl
  await joinMeeting()
}

// ── Past Meetings ─────────────────────────────────────────────────────────────
async function loadPastMeetings() {
  try {
    const res=await fetch(`${BACKEND}/api/meetings`,{credentials:'include'})
    if (!res.ok) return
    const {meetings:list}=await res.json()
    renderPastMeetings(list.filter(m=>m.ended_at))
  } catch {}
}

function renderPastMeetings(list) {
  const el=document.getElementById('pastContent')
  if (!list||!list.length) {
    el.innerHTML='<div class="empty-state"><div class="icon">📂</div><p>No past meetings yet.</p></div>'
    return
  }
  el.innerHTML=`
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Meeting</th><th>Date</th><th>Duration</th><th>Status</th><th>Summary</th><th>Actions</th>
        </tr></thead>
        <tbody>${list.map(m=>`
          <tr>
            <td><span style="font-family:monospace;font-weight:600;color:var(--accent)">${esc(m.meeting_code)}</span></td>
            <td style="color:var(--muted)">${fmtDate(m.started_at)} ${fmtTimeOfDay(m.started_at)}</td>
            <td style="color:var(--muted)">${fmtDuration(m.duration_ms)}</td>
            <td><span class="pill ${m.has_summary?'pill-done':'pill-pending'}">${m.has_summary?'✓ Done':'Processing'}</span></td>
            <td id="sum-past-${esc(m.id)}">
              ${m.has_summary?'<span style="color:var(--muted);font-size:.75rem">Loading…</span>':'<span style="color:#D1D5DB;font-size:.75rem">—</span>'}
            </td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="viewTranscript('${esc(m.id)}')">📄 Transcript</button>
              ${m.has_summary?`<button class="btn btn-secondary btn-sm" style="margin-left:4px" onclick="viewFullSummary('${esc(m.id)}')">🤖 Summary</button>`:''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`

  list.filter(m=>m.has_summary).forEach(m=>loadSummaryPreview(m.id))
}

async function loadSummaryPreview(meetingId) {
  try {
    const res=await fetch(`${BACKEND}/api/meetings/${meetingId}/summary`,{credentials:'include'})
    if (!res.ok) return
    const data=await res.json()
    const el=document.getElementById(`sum-past-${meetingId}`)
    if (el&&data.summary) el.innerHTML=`<div class="summary-preview">${esc(data.summary)}</div>`
  } catch {}
}

async function viewFullSummary(meetingId) {
  try {
    const res=await fetch(`${BACKEND}/api/meetings/${meetingId}/summary`,{credentials:'include'})
    const data=await res.json()
    const w=window.open('','_blank')
    w.document.write(`<!DOCTYPE html><html><head><style>
      body{font-family:-apple-system,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#111827;background:#F4F6F9}
      h1{font-size:1.5rem;font-weight:800;margin-bottom:.5rem}
      .meta{color:#6B7280;font-size:.85rem;margin-bottom:2rem}
      h2{font-size:1rem;font-weight:700;color:#F06428;margin:1.5rem 0 .75rem}
      p{line-height:1.7;color:#374151}
      ul{padding-left:1.25rem} li{margin:.5rem 0;color:#374151;line-height:1.6}
    </style></head><body>
      <h1>Meeting Summary</h1>
      <div class="meta">Code: ${esc(data.meetingCode||'')} • ${fmtDate(data.startedAt||'')} • ${fmtDuration(data.durationMs)}</div>
      <h2>Summary</h2><p>${esc(data.summary||'')}</p>
      ${data.keyInsights?.length?`<h2>Key Insights</h2><ul>${data.keyInsights.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}
    </body></html>`)
  } catch { alert('Failed to load summary') }
}

async function viewTranscript(meetingId) {
  try {
    const res=await fetch(`${BACKEND}/api/meetings/${meetingId}/transcript`,{credentials:'include'})
    const {segments}=await res.json()
    const text=segments.map(s=>`[${fmtTime(s.start_ms)}] ${s.speaker_name||s.speaker_label||'?'}: ${s.text}`).join('\n')
    const w=window.open('','_blank')
    w.document.write(`<!DOCTYPE html><html><head><style>
      body{font-family:monospace;background:#0f1117;color:#e2e8f0;padding:2rem;white-space:pre-wrap;font-size:13px;line-height:1.7}
    </style></head><body>${esc(text)}</body></html>`)
  } catch { alert('Failed to load transcript') }
}

// ── Swap ──────────────────────────────────────────────────────────────────────
let swapMid=null
function openSwap(mid) {
  const m=meetings.get(mid); if (!m) return
  swapMid=mid
  const speakers=[...new Set(m.segments.map(s=>s.speakerName||s.speakerLabel||'?'))]
  if (speakers.length<2){alert('Need at least 2 speakers to swap.');return}
  document.getElementById('swapA').innerHTML=speakers.map(s=>`<option>${esc(s)}</option>`).join('')
  document.getElementById('swapB').innerHTML=speakers.map((s,i)=>`<option ${i===1?'selected':''}>${esc(s)}</option>`).join('')
  document.getElementById('swapModal').classList.add('open')
}
function closeSwap(){document.getElementById('swapModal').classList.remove('open');swapMid=null}
function applySwap() {
  if (!swapMid) return
  const nameA=document.getElementById('swapA').value, nameB=document.getElementById('swapB').value
  if (nameA===nameB){closeSwap();return}
  const m=meetings.get(swapMid); if (!m) return
  m.segments.forEach(s=>{const n=s.speakerName||s.speakerLabel||'?';if(n===nameA)s._swap='A';else if(n===nameB)s._swap='B'})
  m.segments.forEach(s=>{if(s._swap==='A'){s.speakerName=nameB;s.speakerLabel=nameB}else if(s._swap==='B'){s.speakerName=nameA;s.speakerLabel=nameA};delete s._swap})
  const cA=m.speakerColors[nameA],cB=m.speakerColors[nameB]
  if(cA)m.speakerColors[nameB]=cA; if(cB)m.speakerColors[nameA]=cB
  const container=document.getElementById(`tx-${swapMid}`)
  if(container){container.innerHTML='';m.segments.forEach(s=>appendSegmentDirect(swapMid,s,container))}
  closeSwap()
}
function appendSegmentDirect(mid,s,container) {
  const name=s.speakerName||s.speakerLabel||'?', c=getColor(mid,name)
  const el=document.createElement('div'); el.className='segment'
  el.dataset.id=s.id; el.dataset.label=s.speakerLabel||''; el.dataset.mid=mid
  el.style.borderLeftColor=c.border
  el.innerHTML=`<div class="seg-meta"><div class="avatar" style="background:${c.bg};color:${c.text}">${esc(initials(name))}</div><span class="seg-name" style="color:${c.text}">${esc(name)}</span><span class="seg-time">${fmtTime(s.startMs||0)}</span></div><div class="seg-text">${esc(s.text)}</div>`
  container.appendChild(el)
}

init()
