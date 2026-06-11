// ─── Constants ────────────────────────────────────────────────────────────────
const SERVER = 'http://localhost:4567'
const H1B_THRESHOLD = 50
const PROFILE = {
  firstName: 'Rohan',
  lastName:  'Balasubramanian',
  fullName:  'Rohan Balasubramanian',
  email:     'you@example.com',
  phone:     '000-000-0000',
  linkedin:  'https://www.linkedin.com/in/brohan2001/',
  github:    'https://github.com/brohan2001',
  skills:    'Python, Java, JavaScript, TypeScript, Golang, C/C++, PyTorch, TensorFlow, AWS, GCP, Docker, Kubernetes, Terraform, CI/CD',
}
const ENTRY_RE = /associate|junior|\bII\b|0-3\s*years?|grad(?:uate)?|entry/i
const SENIOR_RE = /\bsenior\b|\blead\b|\bstaff\b/i

// ─── LinkedIn SVG icon ────────────────────────────────────────────────────────
const LI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#0a66c2" style="vertical-align:middle;cursor:pointer;margin-left:6px;flex-shrink:0"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`

// ─── State ────────────────────────────────────────────────────────────────────
let h1bData = {}
let seniorityFilterActive = false
let h1bFilterActive = false
let llmProvider = 'claude'

const JOB_STATES = {}

function getJobId() {
  return window.location.pathname.match(/\/jobs\/info\/([^/?#]+)/)?.[1] ?? window.location.pathname
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Utilities ────────────────────────────────────────────────────────────────
function injectStyle(css) {
  const s = document.createElement('style')
  s.textContent = css
  document.head.appendChild(s)
}

function findFirst(selector, root = document) {
  return root.querySelector(selector)
}

function findAll(selector, root = document) {
  return Array.from(root.querySelectorAll(selector))
}

function makeToggleButton(id, label) {
  const btn = document.createElement('button')
  btn.id = id
  btn.textContent = label
  btn.dataset.active = 'false'
  btn.className = 'jseek-toggle'
  return btn
}

// ─── Styles ───────────────────────────────────────────────────────────────────
injectStyle(`
  .jseek-btn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
  }
  .jseek-btn-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .jseek-toggle {
    display: block;
    width: 100%;
    padding: 7px 10px;
    margin: 6px 0;
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    color: #374151;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }
  .jseek-toggle[data-active="true"] {
    background: #dbeafe;
    border-color: #3b82f6;
    color: #1d4ed8;
  }
  .jseek-toggle:hover { background: #e5e7eb; }

  .jseek-h1b-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 12px;
    background: #d1fae5;
    color: #065f46;
    border: 1px solid #6ee7b7;
    margin-left: 6px;
    vertical-align: middle;
    white-space: nowrap;
  }
  .jseek-h1b-badge.low {
    background: #fee2e2;
    color: #991b1b;
    border-color: #fca5a5;
  }

  .jseek-hidden { display: none !important; }
`)

// ─── Feature 1: Action Buttons (Resume / Resume & CL) ────────────────────────
function getDrawerContext(cfg) {
  if (cfg.drawerCompanyHeader) {
    const drawerHeader = findFirst(cfg.drawerCompanyHeader)
    const anchor = drawerHeader?.querySelector('a[href*="/company/"]')
    return {
      companyName: anchor?.textContent.trim() ?? '',
      jobTitle:    findFirst(cfg.drawerJobTitle)?.textContent.trim() ?? '',
    }
  }
  return {
    companyName: findFirst(cfg.companyName)?.textContent.trim() ?? '',
    jobTitle:    findFirst(cfg.jobTitle)?.textContent.trim() ?? '',
  }
}

function sanitizeForFilename(name) {
  return name.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Company'
}

async function callEndpoint(endpoint, payload) {
  const resp = await fetch(`${SERVER}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, provider: llmProvider }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
    let msg = err.error ?? resp.statusText
    if (err.latexError) msg += ` — LaTeX: ${err.latexError.message}${err.latexError.line ? ` (line ${err.latexError.line})` : ''}`
    throw new Error(msg)
  }
  return resp.blob()
}

async function confirmNotDuplicate(companyName, jobTitle) {
  try {
    const r = await fetch(`${SERVER}/applications/check?company=${encodeURIComponent(companyName)}&title=${encodeURIComponent(jobTitle)}`)
    const d = await r.json()
    if (d.duplicate) {
      return confirm(`JSeek: already applied to ${companyName} on ${d.lastDate} (${d.timesApplied}x in the last 30 days). Generate anyway?`)
    }
  } catch { /* check unavailable — never block generation */ }
  return true
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function makePillButton(text, tooltip) {
  const btn = document.createElement('button')
  btn.textContent = text
  btn.title = tooltip
  btn.className = 'rounded-md px-3 py-1.5 text-xs font-medium border border-border-soft transition-colors hover:bg-border-soft cursor-pointer'
  return btn
}

function injectActionButtons(cfg) {
  if (document.getElementById('jseek-btn-row')) return

  const jdEl = findFirst(cfg.jobDescription)
  if (!jdEl) return

  const jobId = getJobId()
  const jobState = JOB_STATES[jobId] ?? {}

  const wrapper = document.createElement('div')
  wrapper.id = 'jseek-btn-row'
  wrapper.className = 'jseek-btn-row'

  const btnResume  = makePillButton('Resume', 'Tailor Resume')
  const btnBoth    = makePillButton('Resume & CL', 'Tailor Resume & Cover Letter')
  const btnMessage = makePillButton('Message', 'Generate LinkedIn Recruiter Outreach')
  const btnEmail   = makePillButton('Email', 'Generate Recruiter Cold Email')

  if (jobState.resume === 'done') btnResume.textContent = `Resume Downloaded ✓ (${jobState.resumeElapsed}s)`
  if (jobState.both === 'done') btnBoth.textContent = `Both Downloaded ✓ (${jobState.bothElapsed}s total)`
  if (jobState.message === 'done') btnMessage.textContent = 'Copied ✓'
  if (jobState.email === 'done') btnEmail.textContent = 'Email Opened ✓'

  function setBusy(busy) {
    btnResume.disabled  = busy
    btnBoth.disabled    = busy
    btnMessage.disabled = busy
    btnEmail.disabled   = busy
  }

  const setBothBusy = setBusy
  const setAllBusy = setBusy

  btnResume.addEventListener('click', async () => {
    const jobDescription = jdEl.innerText.trim()
    if (!jobDescription) { alert('JSeek Enhancer: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)
    const safe = sanitizeForFilename(companyName)
    if (companyName && !(await confirmNotDuplicate(companyName, jobTitle))) return

    const t0 = performance.now()
    let timerInterval = setInterval(() => {
      btnResume.textContent = `Tailoring… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setBusy(true)
    try {
      const blob    = await callEndpoint('/tailor', { jobDescription, companyName, jobTitle })
      const dataUrl = await blobToDataUrl(blob)
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_PDF', dataUrl, filename: `Rohan_Resume_${safe}.pdf` })
      clearInterval(timerInterval); timerInterval = null
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], resume: 'done', resumeElapsed: elapsed }
      btnResume.textContent = `Resume Downloaded ✓ (${elapsed}s)`
      setTimeout(() => { btnResume.textContent = 'Resume' }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`JSeek Enhancer: ${err.message}`)
      btnResume.textContent = 'Resume'
    } finally {
      clearInterval(timerInterval)
      setBusy(false)
    }
  })

  btnBoth.addEventListener('click', async () => {
    const jobDescription = jdEl.innerText.trim()
    if (!jobDescription) { alert('JSeek Enhancer: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)
    const safe = sanitizeForFilename(companyName)
    if (companyName && !(await confirmNotDuplicate(companyName, jobTitle))) return

    const t0 = performance.now()
    let phase = 'Tailoring'
    let timerInterval = setInterval(() => {
      btnBoth.textContent = `${phase}… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setBothBusy(true)
    try {
      const resumeBlob = await callEndpoint('/tailor', { jobDescription, companyName, jobTitle })
      // 2.5s stagger prevents concurrent-connection 429 blocks on free API tiers.
      await sleep(2500)
      phase = 'Writing CL'
      const clBlob = await callEndpoint('/cover-letter', { jd: jobDescription, companyName, jobTitle })
      const [resumeDataUrl, clDataUrl] = await Promise.all([blobToDataUrl(resumeBlob), blobToDataUrl(clBlob)])
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_PDF', dataUrl: resumeDataUrl, filename: `Rohan_Resume_${safe}.pdf` })
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_PDF', dataUrl: clDataUrl, filename: `Rohan_CL_${safe}.pdf` })
      clearInterval(timerInterval); timerInterval = null
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], both: 'done', bothElapsed: elapsed }
      btnBoth.textContent = `Both Downloaded ✓ (${elapsed}s total)`
      setTimeout(() => { btnBoth.textContent = 'Resume & CL' }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`JSeek Enhancer: ${err.message}`)
      btnBoth.textContent = 'Resume & CL'
    } finally {
      clearInterval(timerInterval)
      setBothBusy(false)
    }
  })

  btnMessage.addEventListener('click', async () => {
    const jd = findFirst(cfg.jobDescription)?.innerText.trim()
    if (!jd) { alert('JSeek Enhancer: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)

    const t0 = performance.now()
    let timerInterval = setInterval(() => {
      btnMessage.textContent = `Writing… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setAllBusy(true)
    try {
      const resp = await fetch(`${SERVER}/cold-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jd, companyName, jobTitle }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        throw new Error(err.error ?? resp.statusText)
      }
      const { message } = await resp.json()
      clearInterval(timerInterval); timerInterval = null
      await navigator.clipboard.writeText(message)
      if (companyName) {
        const q = encodeURIComponent(`recruiter AND "${companyName}"`)
        window.open(`https://www.linkedin.com/search/results/people/?keywords=${q}`, '_blank', 'noopener')
      }
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], message: 'done' }
      btnMessage.textContent = 'Copied ✓'
      setTimeout(() => { btnMessage.textContent = 'Message' }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`JSeek Enhancer: ${err.message}`)
      btnMessage.textContent = 'Message'
    } finally {
      clearInterval(timerInterval)
      setAllBusy(false)
    }
  })

  btnEmail.addEventListener('click', async () => {
    const jd = findFirst(cfg.jobDescription)?.innerText.trim()
    if (!jd) { alert('JSeek Enhancer: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)

    const t0 = performance.now()
    let timerInterval = setInterval(() => {
      btnEmail.textContent = `Writing… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setBusy(true)
    try {
      const resp = await fetch(`${SERVER}/cold-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jd, companyName, jobTitle, provider: llmProvider }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        throw new Error(err.error ?? resp.statusText)
      }
      const { subject, body } = await resp.json()
      clearInterval(timerInterval); timerInterval = null
      window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank')
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], email: 'done' }
      btnEmail.textContent = 'Email Opened ✓'
      setTimeout(() => { btnEmail.textContent = 'Email' }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`JSeek Enhancer: ${err.message}`)
      btnEmail.textContent = 'Email'
    } finally {
      clearInterval(timerInterval)
      setBusy(false)
    }
  })

  wrapper.appendChild(btnResume)
  wrapper.appendChild(btnBoth)
  wrapper.appendChild(btnMessage)
  wrapper.appendChild(btnEmail)
  findFirst(cfg.injectTarget)?.insertAdjacentElement(cfg.injectPosition, wrapper)
}

// ─── Feature: ATS Easy Apply Auto-Filler (Greenhouse / Lever / Workday) ──────
const ATS_SLUGS = ['greenhouse', 'lever', 'workday']

const FIELD_PATTERNS = [
  { re: /first[\s_-]?name|legalNameSection_firstName/i, value: () => PROFILE.firstName },
  { re: /last[\s_-]?name|legalNameSection_lastName/i,   value: () => PROFILE.lastName },
  { re: /full[\s_-]?name|^name$|your[\s_-]?name/i,      value: () => PROFILE.fullName },
  { re: /e-?mail/i,                                     value: () => PROFILE.email },
  { re: /phone|mobile/i,                                value: () => PROFILE.phone },
  { re: /linked[\s_-]?in/i,                             value: () => PROFILE.linkedin },
  { re: /github|portfolio|website/i,                    value: () => PROFILE.github },
  { re: /skills/i,                                      value: () => PROFILE.skills },
]

function fieldDescriptor(el) {
  const label = el.labels?.[0]?.textContent
    ?? (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null)
    ?? ''
  return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-automation-id'), label]
    .filter(Boolean)
    .join(' ')
}

// React-based ATS forms (Greenhouse, Workday) ignore plain value assignment,
// so we fire input + change events after setting it.
function setFieldValue(el, value) {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.blur()
}

function autoFillForm() {
  let filled = 0
  findAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea').forEach(el => {
    if (el.value) return
    const desc = fieldDescriptor(el)
    if (!desc) return
    const match = FIELD_PATTERNS.find(p => p.re.test(desc))
    if (!match) return
    setFieldValue(el, match.value())
    filled++
  })
  return filled
}

function injectAutoFillButton() {
  if (document.getElementById('jseek-autofill-btn')) return

  const form = findFirst('form')
  if (!form) return

  const btn = makePillButton('Auto-Fill', 'Fill name, email, GitHub, LinkedIn, and skills from local profile')
  btn.id = 'jseek-autofill-btn'
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    const filled = autoFillForm()
    btn.textContent = filled > 0 ? `Auto-Filled ${filled} fields ✓` : 'No empty fields matched'
    setTimeout(() => { btn.textContent = 'Auto-Fill' }, 3000)
  })
  form.insertAdjacentElement('beforebegin', btn)
}

// ─── Feature 2: Enhanced Seniority Filter ────────────────────────────────────
function injectSeniorityFilter(sidebar) {
  if (document.getElementById('jseek-seniority-toggle')) return

  const btn = makeToggleButton('jseek-seniority-toggle', '🎓 Enhanced Early Career')
  btn.title = 'Show only entry-level roles; hide Senior / Lead / Staff'

  btn.addEventListener('click', () => {
    seniorityFilterActive = !seniorityFilterActive
    btn.dataset.active = String(seniorityFilterActive)
    applySeniorityFilter()
  })

  sidebar.prepend(btn)
}

function applySeniorityFilter() {
  findAll(activeCfg.jobCards).forEach(card => {
    const titleEl = findFirst(activeCfg.jobTitle, card)
    const title = titleEl?.textContent ?? ''

    if (!seniorityFilterActive) {
      card.classList.remove('jseek-hidden')
      return
    }

    if (SENIOR_RE.test(title)) {
      card.classList.add('jseek-hidden')
    } else {
      card.classList.remove('jseek-hidden')
    }
  })
}

// ─── Feature 3: H1-B Badges & Filter ─────────────────────────────────────────
function injectH1bBadges() {
  findAll(activeCfg.companyName).forEach(el => {
    if (el.querySelector('.jseek-h1b-badge')) return

    const company = el.textContent.trim()
    const count = lookupH1b(company)
    if (count === null) return

    const badge = document.createElement('span')
    badge.className = 'jseek-h1b-badge' + (count < H1B_THRESHOLD ? ' low' : '')
    badge.textContent = `H1-B: ${count.toLocaleString()}`
    badge.title = `${company} sponsored ${count.toLocaleString()} H1-B visas (historical)`
    el.appendChild(badge)
  })
}

function lookupH1b(companyName) {
  const key = Object.keys(h1bData).find(
    k => k.toLowerCase() === companyName.toLowerCase() ||
         companyName.toLowerCase().includes(k.toLowerCase())
  )
  return key !== undefined ? h1bData[key] : null
}

function injectH1bFilter(sidebar) {
  if (document.getElementById('jseek-h1b-toggle')) return

  const btn = makeToggleButton('jseek-h1b-toggle', '🌐 H1-B Sponsors Only')
  btn.title = `Show only companies with ≥${H1B_THRESHOLD} H1-B sponsorships`

  btn.addEventListener('click', () => {
    h1bFilterActive = !h1bFilterActive
    btn.dataset.active = String(h1bFilterActive)
    applyH1bFilter()
  })

  sidebar.prepend(btn)
}

function applyH1bFilter() {
  findAll(activeCfg.jobCards).forEach(card => {
    if (!h1bFilterActive) {
      if (!seniorityFilterActive) card.classList.remove('jseek-hidden')
      return
    }

    const companyEl = findFirst(activeCfg.companyName, card)
    const company = companyEl?.textContent.trim() ?? ''
    const count = lookupH1b(company)

    if (count === null || count < H1B_THRESHOLD) {
      card.classList.add('jseek-hidden')
    } else if (!seniorityFilterActive) {
      card.classList.remove('jseek-hidden')
    }
  })
}

// ─── Feature 5: LLM Provider Toggle ──────────────────────────────────────────
function injectLlmToggle(sidebar) {
  if (document.getElementById('jseek-llm-toggle')) return

  const btn = makeToggleButton('jseek-llm-toggle', llmProvider === 'relay' ? '⚡ LLM: Relay (Local)' : '⚡ LLM: Claude')
  btn.title = 'Switch between Claude (remote) and RelayFreeLLM (local gateway)'
  btn.dataset.active = String(llmProvider === 'relay')

  btn.addEventListener('click', () => {
    llmProvider = llmProvider === 'relay' ? 'claude' : 'relay'
    btn.dataset.active = String(llmProvider === 'relay')
    btn.textContent = llmProvider === 'relay' ? '⚡ LLM: Relay (Local)' : '⚡ LLM: Claude'
    chrome.storage.local.set({ llmProvider })
  })

  sidebar.prepend(btn)
}

// ─── Feature 4: LinkedIn Recruiter Finder ────────────────────────────────────
function injectLinkedInButtons() {
  findAll(activeCfg.companyName).forEach(el => {
    if (el.querySelector('.jseek-li-btn')) return

    const company = el.textContent.replace(/H1-B:.*$/i, '').trim()
    if (!company) return

    const btn = document.createElement('span')
    btn.className = 'jseek-li-btn'
    btn.title = `Find recruiters at ${company} on LinkedIn`
    btn.innerHTML = LI_SVG

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const q = encodeURIComponent(`recruiter AND "${company}"`)
      window.open(
        `https://www.linkedin.com/search/results/people/?keywords=${q}`,
        '_blank',
        'noopener'
      )
    })

    el.appendChild(btn)
  })
}

// ─── Feature: Drawer Company Header (H1-B badge + LinkedIn) ──────────────────
// The drawer reuses the same DOM element across jobs, so we key on company name
// to detect job changes and re-inject fresh badges/buttons.
function injectDrawerEnhancements() {
  const drawerHeader = findFirst(activeCfg.drawerCompanyHeader)
  if (!drawerHeader) return

  const anchor = drawerHeader.querySelector('a[href*="/company/"]')
  if (!anchor) return

  const company = anchor.textContent.trim()
  if (!company) return

  if (drawerHeader.dataset.jseekCompany === company) return
  drawerHeader.dataset.jseekCompany = company
  drawerHeader.querySelector('.jseek-h1b-badge')?.remove()
  drawerHeader.querySelector('.jseek-li-btn')?.remove()

  const count = lookupH1b(company)
  if (count !== null) {
    const badge = document.createElement('span')
    badge.className = 'jseek-h1b-badge' + (count < H1B_THRESHOLD ? ' low' : '')
    badge.textContent = `H1-B: ${count.toLocaleString()}`
    badge.title = `${company} sponsored ${count.toLocaleString()} H1-B visas (historical)`
    anchor.insertAdjacentElement('afterend', badge)
  }

  const liBtn = document.createElement('span')
  liBtn.className = 'jseek-li-btn'
  liBtn.title = `Find recruiters at ${company} on LinkedIn`
  liBtn.innerHTML = LI_SVG
  liBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const q = encodeURIComponent(`recruiter AND "${company}"`)
    window.open(
      `https://www.linkedin.com/search/results/people/?keywords=${q}`,
      '_blank',
      'noopener'
    )
  })
  drawerHeader.appendChild(liBtn)
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function loadH1bData() {
  try {
    const url = chrome.runtime.getURL('h1b_data.json')
    const resp = await fetch(url)
    h1bData = await resp.json()
  } catch {
    console.warn('JSeek Enhancer: failed to load h1b_data.json')
  }
}

function runFeatures(cfg) {
  injectActionButtons(cfg)

  if (ATS_SLUGS.includes(cfg.slug)) injectAutoFillButton()

  if (cfg.slug === 'jseek') {
    const sidebarContainer = findFirst(cfg.filterSidebar)
    const sidebarPills = sidebarContainer
      ? findFirst(cfg.filterTagPills, sidebarContainer)
      : null

    injectH1bBadges()
    injectLinkedInButtons()
    injectDrawerEnhancements()

    if (sidebarPills) {
      injectSeniorityFilter(sidebarPills)
      injectH1bFilter(sidebarPills)
      injectLlmToggle(sidebarPills)
    }
  }
}

async function init() {
  const cfg = detectSite()
  if (!cfg) return

  activeCfg = cfg

  if (cfg.slug === 'jseek') await loadH1bData()

  await new Promise(resolve => {
    chrome.storage.local.get('llmProvider', ({ llmProvider: saved }) => {
      if (saved) llmProvider = saved
      resolve()
    })
  })

  runFeatures(cfg)

  // Re-run on dynamic page updates (SPA navigation, drawer open/close, infinite scroll).
  // Debounced to avoid hammering DOM queries on rapid mutations.
  let runTimer = null
  const observer = new MutationObserver(() => {
    clearTimeout(runTimer)
    runTimer = setTimeout(() => runFeatures(cfg), 150)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

init()
