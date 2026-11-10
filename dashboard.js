import { queryStream, shardOf } from './pipeline/jobfilter.js'
import { callBackground } from './bridge.js'

// Reads the public static feed (built by scripts/build-feed.mjs on a GitHub
// Actions schedule) and filters it client-side. Generation actions go through
// the background worker, exactly like the on-page buttons.
const FEED_URL = 'https://brohan2001.github.io/resume-extension/'

const $ = id => document.getElementById(id)
const LOGO_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6']
const colorFor = s => LOGO_COLORS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % LOGO_COLORS.length]
const initials = n => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

function fallbackLogo(name, cls) {
  return `<div class="${cls}-fallback" style="background:${colorFor(name)}">${escHtml(initials(name))}</div>`
}

// Inline onerror handlers are blocked by the extension CSP, so broken logos are
// swapped for initials by a capturing listener instead.
function logoHtml(domain, name, cls) {
  if (!domain) return fallbackLogo(name, cls)
  return `<img class="${cls}" src="https://logo.clearbit.com/${escHtml(domain)}" alt="" data-name="${escHtml(name)}" data-cls="${cls}">`
}
document.addEventListener('error', (e) => {
  const img = e.target
  if (img?.tagName === 'IMG' && img.dataset.cls) img.outerHTML = fallbackLogo(img.dataset.name, img.dataset.cls)
}, true)

function timeAgo(iso) {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const h = ms / 36e5
  if (h < 1) return { t: Math.max(1, Math.round(ms / 6e4)) + 'm', c: 'fresh' }
  if (h < 24) return { t: Math.round(h) + 'h', c: 'recent' }
  const d = Math.round(h / 24)
  if (d < 30) return { t: d + 'd', c: '' }
  return { t: Math.round(d / 30) + 'mo', c: '' }
}

function bucket(iso) {
  const d = (Date.now() - Date.parse(iso)) / 36e5
  if (Number.isNaN(d)) return 'EARLIER'
  if (d < 24) return 'TODAY'
  if (d < 48) return 'YESTERDAY'
  if (d < 24 * 7) return 'THIS WEEK'
  return 'EARLIER'
}

// ── Feed ──
let feed = null
const shardCache = new Map()

async function loadFeed(force = false) {
  if (feed && !force) return feed
  const resp = await fetch(`${FEED_URL}jobs.json`, { cache: force ? 'reload' : 'default' })
  if (!resp.ok) throw new Error(`feed HTTP ${resp.status}`)
  feed = await resp.json()
  if (force) shardCache.clear()
  return feed
}

async function loadDetails(id) {
  const n = shardOf(id)
  if (!shardCache.has(n)) {
    shardCache.set(n, fetch(`${FEED_URL}details/${n}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})))
  }
  return (await shardCache.get(n))[id] ?? null
}

// ── State ──
const filters = { location: 'us', role: 'all', level: 'all', workMode: 'any', h1bOnly: false, earlyOnly: false, q: '' }
let offset = 0
const limit = 100
let total = 0
let jobs = []
let selected = null

async function loadJobs(reset = true, force = false) {
  if (reset) { offset = 0; jobs = [] }
  try {
    const data = await loadFeed(force)
    const page = queryStream(data.jobs, { ...filters, offset, limit })
    total = page.total
    jobs = reset ? page.jobs : jobs.concat(page.jobs)
    $('active-count').textContent = total.toLocaleString()
    $('last-refreshed').textContent = data.ts ? 'Updated ' + new Date(data.ts).toLocaleString() : 'No data yet'
    renderJobs()
  } catch (err) {
    $('showing').textContent = `Could not load the job feed (${err.message}). Check your connection and press Refresh.`
  }
}

function renderJobs() {
  const list = $('job-list')
  list.innerHTML = ''
  $('showing').textContent = `Showing ${jobs.length.toLocaleString()} of ${total.toLocaleString()} jobs`
  $('empty').style.display = jobs.length ? 'none' : 'block'
  let lastBucket = null
  for (const j of jobs) {
    const b = bucket(j.postedAt)
    if (b !== lastBucket) {
      lastBucket = b
      const div = document.createElement('div')
      div.className = 'divider'
      div.innerHTML = `<span class="divider-label">${b}</span><div class="divider-line"></div>`
      list.appendChild(div)
    }
    const ta = timeAgo(j.postedAt) || { t: '', c: '' }
    const h1b = j.h1b != null
      ? `<span class="h1b-badge ${j.h1b >= 50 ? 'h1b-hi' : 'h1b-lo'}">H1-B ${Number(j.h1b)}</span>` : ''
    const row = document.createElement('div')
    row.className = 'row' + (selected?.id === j.id ? ' active' : '')
    row.dataset.id = j.id
    row.innerHTML = `
      <div class="row-radio"></div>
      ${logoHtml(j.companyDomain, j.company, 'logo')}
      <span class="row-company">${escHtml(j.company)}</span>
      ${h1b}
      <span class="row-title">${escHtml(j.title)}</span>
      <span class="row-score">${Number(j.score) || 0}</span>
      <span class="row-time ${ta.c}">${ta.t}</span>`
    row.addEventListener('click', () => selectJob(j.id))
    list.appendChild(row)
  }
  $('load-more').style.display = jobs.length < total ? 'block' : 'none'
}

// ── Detail panel ──
async function selectJob(id) {
  document.querySelectorAll('.row.active').forEach(r => r.classList.remove('active'))
  document.querySelector(`.row[data-id="${CSS.escape(id)}"]`)?.classList.add('active')
  const base = feed?.jobs.find(j => j.id === id)
  if (!base) return
  const details = await loadDetails(id)
  const job = { ...base, description: details?.description ?? '', scores: details?.scores }
  selected = job
  $('panel').classList.add('open')
  $('panel-logo-slot').innerHTML = logoHtml(job.companyDomain, job.company, 'panel-logo')
  $('panel-co').textContent = job.company
  $('panel-co-meta').textContent = [job.location, job.source].filter(Boolean).join(' · ')
  $('panel-title').textContent = job.title
  $('panel-view').onclick = () => window.open(job.url, '_blank', 'noopener')

  const visaBadge = job.visa === 1 ? '<span class="badge b-visa-yes">✓ Sponsors visa</span>'
    : job.visa === -1 ? '<span class="badge b-visa-no">✕ No sponsorship</span>'
      : '<span class="badge b-visa-unk">? Visa unknown</span>'
  $('panel-badges').innerHTML = visaBadge
    + `<span class="badge b-role">${escHtml(job.role)}</span>`
    + `<span class="badge b-level">${escHtml(job.level)}</span>`
    + (job.location ? `<span class="badge b-loc">${escHtml(job.location)}</span>` : '')

  $('panel-desc').textContent = job.description || 'No description available. Open the posting to read it.'
  $('panel-desc').classList.remove('open')
  $('desc-chevron').textContent = '▾'
  const s = job.scores
  $('score-strip').innerHTML = s
    ? [['skill', s.skill, 35], ['role', s.role, 25], ['visa', s.visa, 20], ['recency', s.recency, 10], ['company', s.company, 10], ['total', s.total, 100]]
      .map(([l, p, m]) => `<div class="sitem"><span class="pts">${Number(p) || 0}</span><span class="max">/${m}</span><span class="lbl">${l}</span></div>`).join('')
    : ''
  setStatus('')
  $('msg-wrap').style.display = 'none'
}

$('panel-close').addEventListener('click', () => {
  $('panel').classList.remove('open')
  selected = null
  document.querySelectorAll('.row.active').forEach(r => r.classList.remove('active'))
})
$('desc-toggle').addEventListener('click', () => {
  const d = $('panel-desc')
  d.classList.toggle('open')
  $('desc-chevron').textContent = d.classList.contains('open') ? '▴' : '▾'
})

// ── Tailor actions (operate on the selected job) ──
const actButtons = ['btn-resume', 'btn-cl', 'btn-msg', 'btn-email'].map($)
let timerInterval = null
function startTimer() {
  const t0 = performance.now()
  timerInterval = setInterval(() => { $('timer').textContent = ' ' + ((performance.now() - t0) / 1000).toFixed(1) + 's' }, 100)
  return t0
}
function stopTimer(t0) {
  clearInterval(timerInterval)
  const e = ((performance.now() - t0) / 1000).toFixed(1)
  $('timer').textContent = ' ' + e + 's'
  return e
}
function setBusy(b) { actButtons.forEach(x => { x.disabled = b }) }
function setStatus(t, err = false) {
  $('status').className = 'status' + (err ? ' error' : '')
  $('status').innerHTML = escHtml(t) + '<span class="timer" id="timer"></span>'
}
function describe(err) {
  return err.latexError ? `${err.message} — LaTeX: ${err.latexError.message}${err.latexError.line ? ` (line ${err.latexError.line})` : ''}` : err.message
}

function jobInputs() {
  return { jd: (selected.description || '').trim(), companyName: selected.company, jobTitle: selected.title }
}

async function confirmNotDup(company, title) {
  if (!company) return true
  try {
    const d = await callBackground('CHECK_DUPLICATE', { company, title })
    if (d.duplicate) return confirm(`Already applied to ${company} on ${d.lastDate} (${d.timesApplied}x in 30 days). Generate anyway?`)
  } catch {}
  return true
}

async function runPdfs({ coverLetter }) {
  if (!selected) return
  const { jd, companyName, jobTitle } = jobInputs()
  if (!jd) { setStatus('No job description available. Open the posting and use the on-page buttons instead.', true); return }
  if (!(await confirmNotDup(companyName, jobTitle))) return
  setBusy(true)
  setStatus('Tailoring resume…')
  const t0 = startTimer()
  try {
    const r = await callBackground('TAILOR', { jobDescription: jd, companyName, jobTitle })
    let msg = `${r.matchScore != null ? `${r.matchScore}% match. ` : ''}Downloaded ${r.filename}`
    if (coverLetter) {
      setStatus('Writing cover letter…')
      const cl = await callBackground('COVER_LETTER', { jd, companyName, jobTitle })
      msg += ` and ${cl.filename}`
    }
    setStatus(`Done in ${stopTimer(t0)}s. ${msg}.`)
    loadApplications()
  } catch (err) {
    stopTimer(t0)
    setStatus(describe(err), true)
  } finally {
    setBusy(false)
  }
}

$('btn-resume').addEventListener('click', () => runPdfs({ coverLetter: false }))
$('btn-cl').addEventListener('click', () => runPdfs({ coverLetter: true }))
$('btn-msg').addEventListener('click', async () => {
  if (!selected) return
  setBusy(true)
  setStatus('Generating message…')
  const t0 = startTimer()
  try {
    const { message } = await callBackground('COLD_MESSAGE', jobInputs())
    $('message').value = message
    $('msg-wrap').style.display = 'block'
    setStatus(`Done in ${stopTimer(t0)}s.`)
  } catch (err) {
    stopTimer(t0)
    setStatus(describe(err), true)
  } finally {
    setBusy(false)
  }
})
$('btn-email').addEventListener('click', async () => {
  if (!selected) return
  setBusy(true)
  setStatus('Generating email…')
  const t0 = startTimer()
  try {
    const { subject, body } = await callBackground('COLD_EMAIL', jobInputs())
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
    setStatus(`Done in ${stopTimer(t0)}s. Email draft opened.`)
  } catch (err) {
    stopTimer(t0)
    setStatus(describe(err), true)
  } finally {
    setBusy(false)
  }
})
$('copy-btn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('message').value)
  $('copy-btn').textContent = 'Copied ✓'
  setTimeout(() => { $('copy-btn').textContent = 'Copy to Clipboard' }, 2000)
})

// ── Filter chips ──
function closeDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'))
  document.querySelectorAll('.chip.open').forEach(c => c.classList.remove('open'))
}
document.querySelectorAll('.chip[data-chip]').forEach(chip => {
  const key = chip.dataset.chip
  chip.addEventListener('click', e => {
    e.stopPropagation()
    const dd = $('dd-' + key)
    const wasOpen = dd.classList.contains('open')
    closeDropdowns()
    if (!wasOpen) { dd.classList.add('open'); chip.classList.add('open') }
  })
  $('dd-' + key).querySelectorAll('.ditem').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation()
      $('dd-' + key).querySelectorAll('.ditem').forEach(i => { i.classList.remove('selected'); i.querySelector('.check').textContent = '' })
      item.classList.add('selected')
      item.querySelector('.check').textContent = '✓'
      filters[key] = item.dataset.val
      $('lbl-' + key).textContent = item.textContent.trim()
      chip.classList.toggle('active', item.dataset.val !== 'all' && item.dataset.val !== 'any')
      closeDropdowns()
      loadJobs(true)
    })
  })
})
document.addEventListener('click', closeDropdowns)

$('toggle-h1b').addEventListener('click', () => { filters.h1bOnly = !filters.h1bOnly; $('toggle-h1b').classList.toggle('active', filters.h1bOnly); loadJobs(true) })
$('toggle-early').addEventListener('click', () => { filters.earlyOnly = !filters.earlyOnly; $('toggle-early').classList.toggle('active', filters.earlyOnly); loadJobs(true) })

let searchTimer = null
$('search').addEventListener('input', e => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { filters.q = e.target.value.trim(); loadJobs(true) }, 300)
})
$('load-more-btn').addEventListener('click', () => { offset += limit; loadJobs(false) })

// ── Refresh (re-download the feed; it is rebuilt server-side every ~30 min) ──
$('refresh-btn').addEventListener('click', async () => {
  $('refresh-btn').disabled = true
  $('refresh-icon').innerHTML = '<span class="spinner"></span>'
  await loadJobs(true, true)
  $('refresh-btn').disabled = false
  $('refresh-icon').innerHTML = ''
  showToast('Job feed reloaded')
})

function showToast(t) {
  const el = $('toast')
  el.textContent = t
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), 3000)
}

// ── Applications modal ──
let allApplications = []
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: u, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(u), 10_000)
}
function renderApplications() {
  const q = $('app-filter').value.trim().toLowerCase()
  const rows = allApplications.filter(a => !q || `${a.company} ${a.title}`.toLowerCase().includes(q))
  const tb = $('app-table').querySelector('tbody')
  tb.innerHTML = ''
  for (const a of [...rows].reverse()) {
    const tr = document.createElement('tr')
    for (const v of [a.date, a.company, a.title, a.resumePath ? '✓' : '—', a.clPath ? '✓' : '—']) {
      const td = document.createElement('td')
      td.textContent = v ?? ''
      tr.appendChild(td)
    }
    tb.appendChild(tr)
  }
  $('app-count').textContent = q ? `(${rows.length}/${allApplications.length})` : `(${allApplications.length})`
}
async function loadApplications() {
  try { allApplications = await callBackground('GET_LEDGER'); renderApplications() } catch {}
}
$('app-filter').addEventListener('input', renderApplications)
$('export-csv').addEventListener('click', () => {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = ['Date,Company,Title,Resume,CL'].concat(allApplications.map(a => [a.date, a.company, a.title, a.resumePath ?? '', a.clPath ?? ''].map(esc).join(','))).join('\n')
  downloadBlob(new Blob([csv], { type: 'text/csv' }), 'applications.csv')
})

$('open-apps').addEventListener('click', () => { loadApplications(); $('apps-modal').classList.add('open') })
$('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage())
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).classList.remove('open')))
document.querySelectorAll('.modal-bg').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open') }))

// ── Setup status ──
async function loadHealth() {
  try {
    const st = await callBackground('STATUS')
    const ready = st.backend === 'local' || (st.hasKey && st.hasResume)
    const label = st.backend === 'local' ? 'local server'
      : ready ? 'ready' : !st.hasKey ? 'add an AI key in Settings' : 'import your resume in Settings'
    $('health-line').innerHTML = `<span style="color:${ready ? 'var(--green)' : 'var(--red)'}">●</span> ${escHtml(label)}`
    actButtons.forEach(b => { b.title = ready ? '' : label })
  } catch {}
  const { profile } = await chrome.storage.local.get('profile')
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')
  $('wl-handle').textContent = name
}

loadHealth()
loadApplications()
loadJobs(true)
