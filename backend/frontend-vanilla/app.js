const BACKEND    = 'http://localhost:8001'
const BACKEND_WS = 'ws://localhost:8001'

const meetings = new Map()

const COLORS = [
  { bg:'#EDE9FE', text:'#5B21B6', border:'#8B5CF6' },
  { bg:'#D1FAE5', text:'#065F46', border:'#10B981' },
  { bg:'#FEF3C7', text:'#92400E', border:'#F59E0B' },
  { bg:'#FCE7F3', text:'#9D174D', border:'#EC4899' },
  { bg:'#DBEAFE', text:'#1E40AF', border:'#3B82F6' },
  { bg:'#FEE2E2', text:'#991B1B', border:'#EF4444' },
]

let currentUser = null
let prevPage = 'dashboard'
let allMeetingsCache = []

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadUser()

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  document.getElementById('dashGreeting').textContent = greeting

  if (currentUser) {
    document.getElementById('dashUserName').textContent = currentUser.name.split(' ')[0]
  }

  document.getElementById('meetUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinMeeting()
  })
  document.getElementById('dashMeetUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinFromDash()
  })

  const params = new URLSearchParams(location.search)
  if (params.get('auth_error')) {
    alert('Google sign-in failed: ' + params.get('auth_error'))
    history.replaceState({}, '', '/')
  }

  loadDashboard()
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
  const ini = currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  footer.innerHTML = `
    <div class="user-row">
      <div class="user-avatar">${currentUser.picture ? `<img src="${esc(currentUser.picture)}" />` : ini}</div>
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
  dashboard:      ['Dashboard',       'Overview of your meetings'],
  live:           ['Live Recording',  'Real-time transcription with speaker identification'],
  calendar:       ['Calendar',        'Upcoming meetings from Google Calendar'],
  'all-meetings': ['All Meetings',    'Browse and search all your recorded meetings'],
  'meeting-detail':['Meeting Details','Transcript, summary, and analytics'],
  profile:        ['Profile',         'Account settings and preferences'],
}

function showPage(name, el) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'))
  if (el) el.classList.add('active')
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById(`page-${name}`)?.classList.add('active')
  const [title, sub] = PAGE_TITLES[name] || ['MeetMaster', '']
  document.getElementById('topbarTitle').textContent = title
  document.getElementById('topbarSub').textContent = sub

  if (name === 'dashboard')    loadDashboard()
  if (name === 'calendar')     loadCalendarEvents()
  if (name === 'all-meetings') loadAllMeetings()
  if (name === 'profile')      renderProfile()
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

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const fetches = [fetch(`${BACKEND}/api/meetings`, { credentials:'include' })]
    if (currentUser) fetches.push(fetch(`${BACKEND}/api/calendar/events`, { credentials:'include' }))

    const [meetingsRes, eventsRes] = await Promise.all(fetches)

    let allMtgs = []
    if (meetingsRes?.ok) {
      const d = await meetingsRes.json()
      allMtgs = d.meetings || []
    }

    let events = []
    if (eventsRes?.ok) {
      const d = await eventsRes.json()
      events = d.events || []
    }

    renderDashStats(allMtgs)
    renderDashUpcoming(events)
    renderDashRecent(allMtgs.filter(m => m.ended_at).slice(0, 10))

    if (currentUser) {
      document.getElementById('dashUserName').textContent = currentUser.name.split(' ')[0]
    }
  } catch(err) {
    console.error('[dashboard]', err)
  }
}

function renderDashStats(list) {
  const completed   = list.filter(m => m.ended_at).length
  const live        = list.filter(m => !m.ended_at).length
  const withSummary = list.filter(m => m.has_summary).length
  const totalMs     = list.reduce((s, m) => s + (m.duration_ms || 0), 0)
  const hours       = (totalMs / 3_600_000).toFixed(1)

  document.getElementById('dashStats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Meetings</div>
      <div class="stat-value">${list.length}</div>
      <div class="stat-sub">${completed} completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Live Now</div>
      <div class="stat-value" style="color:${live?'var(--success)':'var(--text)'}">${live}</div>
      <div class="stat-sub">active recording${live!==1?'s':''}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">AI Summaries</div>
      <div class="stat-value" style="color:var(--accent)">${withSummary}</div>
      <div class="stat-sub">generated</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Hours Recorded</div>
      <div class="stat-value">${hours}</div>
      <div class="stat-sub">total recording time</div>
    </div>`
}

function renderDashUpcoming(events) {
  const el = document.getElementById('dashUpcoming')
  if (!currentUser) {
    el.innerHTML = `<div class="dash-empty">
      <a href="/auth/google" style="color:var(--accent);font-weight:600">Connect Google</a>
      <br><span style="margin-top:4px;display:block">to see upcoming meetings</span>
    </div>`
    return
  }

  const now = new Date()
  const upcoming = events
    .filter(ev => new Date(ev.startTime) > now)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .slice(0, 5)

  if (!upcoming.length) {
    el.innerHTML = `<div class="dash-empty">
      No upcoming meetings found.<br>
      <button class="btn btn-secondary btn-sm" style="margin-top:.875rem" onclick="syncCalendar()">🔄 Sync Calendar</button>
    </div>`
    return
  }

  el.innerHTML = upcoming.map(ev => {
    const start   = new Date(ev.startTime)
    const diffMs  = start - now
    const diffMin = Math.floor(diffMs / 60_000)
    const badge   = diffMin < 60
      ? `in ${diffMin}m`
      : diffMs < 86_400_000
        ? fmtTimeOfDay(start)
        : fmtDate(start)

    return `<div class="dash-item" onclick="joinFromCalendar('${esc(ev.meetUrl)}')">
      <div class="dash-item-icon" style="background:var(--accent-light)">📅</div>
      <div class="dash-item-body">
        <div class="dash-item-title">${esc(ev.title)}</div>
        <div class="dash-item-sub">${fmtDate(start)} · ${fmtTimeOfDay(start)}</div>
      </div>
      <div class="dash-item-end">
        <span class="pill pill-pending">${esc(badge)}</span>
      </div>
    </div>`
  }).join('')
}

function renderDashRecent(list) {
  const el = document.getElementById('dashRecent')
  if (!list.length) {
    el.innerHTML = `<div class="dash-empty">No completed meetings yet.</div>`
    return
  }
  el.innerHTML = list.map(m => `
    <div class="dash-item" onclick="openMeetingDetail('${esc(m.id)}')">
      <div class="dash-item-icon" style="background:${m.has_summary ? 'rgba(5,150,105,.1)' : 'var(--bg)'}">
        ${m.has_summary ? '🤖' : '📄'}
      </div>
      <div class="dash-item-body">
        <div class="dash-item-title">${esc(m.title || m.meeting_code)}</div>
        <div class="dash-item-sub">${fmtDate(m.started_at)} · ${fmtDuration(m.duration_ms)}</div>
      </div>
      <div class="dash-item-end">
        <span class="pill ${m.has_summary ? 'pill-done' : 'pill-pending'}">${m.has_summary ? 'Done' : 'Processing'}</span>
      </div>
    </div>`).join('')
}

async function joinFromDash() {
  const input = document.getElementById('dashMeetUrl')
  const url = input.value.trim()
  if (!url) return
  input.value = ''
  document.getElementById('meetUrl').value = url
  showPage('live', document.querySelector('[data-page="live"]'))
  await joinMeeting()
}

// ── Join (Live Recording) ─────────────────────────────────────────────────────
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

// ── Live Cards ────────────────────────────────────────────────────────────────
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
    if (msg.type==='bot.error')         setStatus(mid,'error', msg.error || 'Bot error')
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

// ── Summary polling ───────────────────────────────────────────────────────────
async function pollSummary(mid, attempts=0) {
  if (attempts > 20) return
  try {
    const res = await fetch(`${BACKEND}/api/meetings/${mid}/summary`, { credentials:'include' })
    if (!res.ok) return
    const data = await res.json()
    if (data.summary) {
      showSummaryInCard(mid, data.summary, data.keyInsights||[])
      setStatus(mid,'','Meeting ended')
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

// ── Live actions ──────────────────────────────────────────────────────────────
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
  const btns = document.querySelectorAll('#btnSync, [onclick="syncCalendar()"]')
  btns.forEach(b => { b.disabled=true; b.textContent='Syncing…' })
  try {
    const res=await fetch(`${BACKEND}/api/calendar/sync`,{method:'POST',credentials:'include'})
    if (!res.ok) throw new Error((await res.json()).error||'Sync failed')
    const data=await res.json()
    renderCalendarEvents(data.events)
    btns.forEach(b => { b.textContent=`✓ ${data.synced} synced` })
    setTimeout(()=> btns.forEach(b => { b.textContent='🔄 Sync'; b.disabled=false }), 2500)
  } catch(err) {
    alert('Sync error: '+err.message)
    btns.forEach(b => { b.disabled=false; b.textContent='🔄 Sync Calendar' })
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
      <div class="alert alert-info" style="margin-bottom:1rem">No upcoming Google Meet meetings found in the next 25 days.</div>`
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
  showPage('live', document.querySelector('[data-page="live"]'))
  document.getElementById('meetUrl').value=meetUrl
  await joinMeeting()
}

// ── All Meetings ──────────────────────────────────────────────────────────────
async function loadAllMeetings() {
  try {
    const res = await fetch(`${BACKEND}/api/meetings`, { credentials:'include' })
    if (!res.ok) return
    const { meetings: list } = await res.json()
    allMeetingsCache = list
    filterAndRenderMeetings()
  } catch {}
}

function filterAndRenderMeetings() {
  const query  = (document.getElementById('meetingSearch')?.value || '').toLowerCase()
  const status = document.getElementById('statusFilter')?.value || ''
  const sort   = document.getElementById('sortFilter')?.value || 'newest'

  let filtered = allMeetingsCache.filter(m => m.ended_at)

  if (query) {
    filtered = filtered.filter(m =>
      (m.meeting_code||'').toLowerCase().includes(query) ||
      (m.title||'').toLowerCase().includes(query)
    )
  }
  if (status === 'done')       filtered = filtered.filter(m => m.has_summary)
  if (status === 'processing') filtered = filtered.filter(m => !m.has_summary)

  if (sort === 'oldest')  filtered.sort((a,b) => new Date(a.started_at) - new Date(b.started_at))
  if (sort === 'longest') filtered.sort((a,b) => (b.duration_ms||0) - (a.duration_ms||0))

  const countEl = document.getElementById('meetingsCount')
  if (countEl) countEl.textContent = `${filtered.length} meeting${filtered.length!==1?'s':''}`

  renderAllMeetingsTable(filtered)
}

function renderAllMeetingsTable(list) {
  const el = document.getElementById('allMeetingsContent')
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📂</div><p>No meetings found.</p></div>'
    return
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Meeting</th>
          <th>Date &amp; Time</th>
          <th>Duration</th>
          <th>Status</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>${list.map(m => `
          <tr class="clickable-row" onclick="openMeetingDetail('${esc(m.id)}')">
            <td>
              <span style="font-family:monospace;font-weight:700;color:var(--accent)">${esc(m.meeting_code)}</span>
              ${m.title ? `<div style="font-size:.75rem;color:var(--muted);margin-top:2px">${esc(m.title)}</div>` : ''}
            </td>
            <td>
              <span style="color:var(--text)">${fmtDate(m.started_at)}</span>
              <br><span style="font-size:.75rem;color:var(--muted)">${fmtTimeOfDay(m.started_at)}</span>
            </td>
            <td style="color:var(--muted)">${fmtDuration(m.duration_ms)}</td>
            <td><span class="pill ${m.has_summary?'pill-done':'pill-pending'}">${m.has_summary?'✓ Done':'Processing'}</span></td>
            <td onclick="event.stopPropagation()" style="white-space:nowrap">
              <button class="btn btn-secondary btn-sm" onclick="openMeetingDetail('${esc(m.id)}')">View</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`
}

// ── Meeting Detail ────────────────────────────────────────────────────────────
function openMeetingDetail(meetingId) {
  // Remember which nav page sent us here so Back works
  const activeLink = document.querySelector('.nav-link.active')
  prevPage = activeLink?.dataset?.page || 'dashboard'

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'))
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById('page-meeting-detail').classList.add('active')
  document.getElementById('topbarTitle').textContent = 'Meeting Details'
  document.getElementById('topbarSub').textContent = ''

  // Reset
  document.getElementById('detailCode').textContent = '—'
  document.getElementById('detailMeta').textContent = ''
  document.getElementById('detailStatusPill').textContent = ''
  document.getElementById('detailTranscript').innerHTML =
    '<div style="color:var(--muted);font-size:.85rem;text-align:center;padding:2rem">Loading transcript…</div>'
  document.getElementById('detailSummary').textContent = 'Loading…'
  document.getElementById('detailInsights').innerHTML = ''
  document.getElementById('detailInsightsCard').style.display = 'none'

  loadMeetingDetail(meetingId)
}

function goBack() {
  const targetLink = document.querySelector(`[data-page="${prevPage}"]`)
  showPage(prevPage, targetLink)
}

async function loadMeetingDetail(meetingId) {
  try {
    const [txRes, sumRes] = await Promise.all([
      fetch(`${BACKEND}/api/meetings/${meetingId}/transcript`, { credentials:'include' }),
      fetch(`${BACKEND}/api/meetings/${meetingId}/summary`,    { credentials:'include' }),
    ])

    const { segments = [] } = txRes.ok ? await txRes.json() : {}
    const summary = sumRes.ok ? await sumRes.json() : null

    // Header
    if (summary) {
      document.getElementById('detailCode').textContent = summary.meetingCode || meetingId
      document.getElementById('detailMeta').textContent =
        `${fmtDate(summary.startedAt)} at ${fmtTimeOfDay(summary.startedAt)} · ${fmtDuration(summary.durationMs)}`
      const pill = document.getElementById('detailStatusPill')
      if (summary.summary) {
        pill.className = 'pill pill-done'; pill.textContent = '✓ Summarized'
      } else {
        pill.className = 'pill pill-pending'; pill.textContent = 'Processing'
      }
    }

    renderDetailTranscript(segments)
    renderDetailAnalytics(segments, summary)

    // Summary / AI rewrite
    const sumEl = document.getElementById('detailSummary')
    if (summary?.summary) {
      sumEl.textContent = summary.summary
    } else {
      sumEl.innerHTML = '<span style="color:var(--muted)">Summary not yet available — check back after the meeting ends.</span>'
    }

    // Key insights
    if (summary?.keyInsights?.length) {
      document.getElementById('detailInsights').innerHTML =
        summary.keyInsights.map(i =>
          `<div class="insight-item"><span class="insight-bullet">→</span><span>${esc(i)}</span></div>`
        ).join('')
      document.getElementById('detailInsightsCard').style.display = ''
    }
  } catch(err) {
    console.error('[meeting-detail]', err)
  }
}

function renderDetailTranscript(segments) {
  const container = document.getElementById('detailTranscript')
  if (!segments.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:.85rem;text-align:center;padding:2rem">No transcript available.</div>'
    return
  }
  const speakerColors = {}; let colorIdx = 0
  container.innerHTML = segments.map(seg => {
    const name = seg.speaker_name || seg.speaker_label || '?'
    if (!speakerColors[name]) speakerColors[name] = COLORS[colorIdx++ % COLORS.length]
    const c = speakerColors[name]
    return `<div class="segment" style="border-left-color:${c.border}">
      <div class="seg-meta">
        <div class="avatar" style="background:${c.bg};color:${c.text}">${esc(initials(name))}</div>
        <span class="seg-name" style="color:${c.text}">${esc(name)}</span>
        <span class="seg-time">${fmtTime(seg.start_ms||0)}</span>
      </div>
      <div class="seg-text">${esc(seg.text)}</div>
    </div>`
  }).join('')
}

function renderDetailAnalytics(segments, summary) {
  const speakers  = new Set(segments.map(s => s.speaker_name || s.speaker_label || '?'))
  const wordCount = segments.reduce((sum, s) => sum + (s.text||'').split(/\s+/).filter(Boolean).length, 0)
  const durMs     = summary?.durationMs || 0
  const wpm       = durMs > 0 ? Math.round(wordCount / (durMs / 60_000)) : 0

  document.getElementById('detailAnalytics').innerHTML = `
    <div class="analytics-item">
      <div class="analytics-num">${segments.length}</div>
      <div class="analytics-label">Segments</div>
    </div>
    <div class="analytics-item">
      <div class="analytics-num">${speakers.size}</div>
      <div class="analytics-label">Speakers</div>
    </div>
    <div class="analytics-item">
      <div class="analytics-num">${wordCount.toLocaleString()}</div>
      <div class="analytics-label">Words</div>
    </div>
    <div class="analytics-item">
      <div class="analytics-num">${wpm || '—'}</div>
      <div class="analytics-label">Words / Min</div>
    </div>`
}

// ── Profile ───────────────────────────────────────────────────────────────────
function renderProfile() {
  if (!currentUser) {
    document.getElementById('profileCard').innerHTML = `
      <div style="text-align:center;padding:2rem">
        <p style="color:var(--muted);margin-bottom:1rem">Sign in to manage your profile and settings.</p>
        <a href="/auth/google" class="btn btn-primary">Connect Google Account</a>
      </div>`
    document.getElementById('autoBotSettings').innerHTML =
      '<div style="padding:1.5rem;color:var(--muted);font-size:.85rem;text-align:center">Sign in to configure auto-bot settings.</div>'
    return
  }

  const ini = currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  const autoMins   = currentUser.autoJoinMinutes || 0
  const autoEnabled = autoMins > 0

  document.getElementById('profileCard').innerHTML = `
    <div class="profile-avatar-lg">${currentUser.picture ? `<img src="${esc(currentUser.picture)}" />` : ini}</div>
    <div class="profile-name">${esc(currentUser.name)}</div>
    <div class="profile-email">${esc(currentUser.email)}</div>
    <div class="profile-meta">
      <div class="profile-meta-row">
        <span class="profile-meta-label">Account type</span>
        <span class="profile-meta-value">Google</span>
      </div>
      <div class="profile-meta-row">
        <span class="profile-meta-label">Auto-bot join</span>
        <span class="profile-meta-value" style="color:${autoEnabled?'var(--success)':'var(--muted)'}">
          ${autoEnabled ? `${autoMins} min before` : 'Disabled'}
        </span>
      </div>
    </div>
    <button class="btn btn-secondary btn-sm" style="margin-top:1.5rem;width:100%" onclick="logout()">Sign out</button>`

  renderAutoBotSettings(autoMins)
}

function renderAutoBotSettings(currentMins) {
  const enabled = currentMins > 0
  const mins    = enabled ? currentMins : 3

  document.getElementById('autoBotSettings').innerHTML = `
    <div class="settings-row">
      <div>
        <div class="settings-label">Enable Auto-Bot Join</div>
        <div class="settings-desc">Bot automatically joins meetings from Google Calendar at the scheduled time</div>
      </div>
      <div class="settings-control">
        <button class="toggle ${enabled?'on':''}" id="autoBotToggle" onclick="toggleAutoBotSwitch(this)"></button>
      </div>
    </div>
    <div class="settings-row" id="autoBotMinsRow" style="${enabled?'':'opacity:.45;pointer-events:none'}">
      <div>
        <div class="settings-label">Minutes Before Meeting</div>
        <div class="settings-desc">How many minutes early the bot joins before the meeting starts</div>
      </div>
      <div class="settings-control">
        <div class="range-wrap">
          <input type="range" class="range-input" id="autoBotMins" min="1" max="15" value="${mins}"
            oninput="document.getElementById('autoBotMinsVal').textContent=this.value+' min'"/>
          <span class="range-val" id="autoBotMinsVal">${mins} min</span>
        </div>
      </div>
    </div>`
}

function toggleAutoBotSwitch(btn) {
  btn.classList.toggle('on')
  const isOn = btn.classList.contains('on')
  const row  = document.getElementById('autoBotMinsRow')
  if (row) row.style.cssText = isOn ? '' : 'opacity:.45;pointer-events:none'
}

async function saveAutoBotSettings() {
  const isOn = document.getElementById('autoBotToggle')?.classList.contains('on')
  const mins = isOn ? parseInt(document.getElementById('autoBotMins')?.value || '3', 10) : 0

  const btn = document.getElementById('btnSaveSettings')
  btn.disabled = true; btn.textContent = 'Saving…'

  try {
    const res = await fetch(`${BACKEND}/auth/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ autoJoinMinutes: mins }),
    })
    if (!res.ok) throw new Error('Failed')
    if (currentUser) currentUser.autoJoinMinutes = mins

    btn.textContent = '✓ Saved!'
    btn.className   = 'btn btn-success'
    btn.style.width = '100%'
    setTimeout(() => {
      btn.textContent = 'Save Settings'
      btn.className   = 'btn btn-primary'
      btn.style.width = '100%'
      btn.disabled    = false
      renderProfile() // refresh profile card status text
    }, 2000)
  } catch {
    alert('Failed to save settings. Please try again.')
    btn.disabled = false; btn.textContent = 'Save Settings'
  }
}

// ── Swap ──────────────────────────────────────────────────────────────────────
let swapMid = null
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
