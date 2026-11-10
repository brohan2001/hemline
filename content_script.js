// ─── Constants ────────────────────────────────────────────────────────────────
const H1B_THRESHOLD = 50
// Every field starts blank: auto-fill only ever uses what the user saved on the
// options page, never a baked-in identity.
const DEFAULT_PROFILE = {
  firstName: '', lastName: '', fullName: '', email: '', phone: '', linkedin: '', github: '', skills: '',
  city: '', state: '', stateAbbr: '', country: '', zip: '',
  workAuthorization: '', requireSponsorship: '', yearsExperience: '', educationLevel: '',
  university: '', major: '', graduationYear: '', gpa: '', startDate: '',
  salaryMin: '', salaryMax: '', gender: '', race: '', veteranStatus: '',
}
// Overridden from chrome.storage in init() when the options page saved a profile.
let PROFILE = DEFAULT_PROFILE
const ENTRY_RE = /associate|junior|\bII\b|0-3\s*years?|grad(?:uate)?|entry/i
const SENIOR_RE = /\bsenior\b|\blead\b|\bstaff\b/i

// ─── LinkedIn SVG icon ────────────────────────────────────────────────────────
const LI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#0a66c2" style="vertical-align:middle;cursor:pointer;margin-left:6px;flex-shrink:0"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`

// ─── State ────────────────────────────────────────────────────────────────────
let h1bData = {}
let seniorityFilterActive = false
let h1bFilterActive = false
let llmProvider = 'claude'
let serverUp = true
let backendMode = 'extension'
let notReadyReason = ''
let hemlineBusy = false
let batchApplyActive = false

const JOB_STATES = {}

function persistJobStates() {
  chrome.storage.local.set({ jobStates: JOB_STATES })
}

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
  btn.className = 'hemline-toggle'
  return btn
}

// ─── Styles ───────────────────────────────────────────────────────────────────
injectStyle(`
  .hemline-btn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
  }
  .hemline-btn-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hemline-toggle {
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
  .hemline-toggle[data-active="true"] {
    background: #dbeafe;
    border-color: #3b82f6;
    color: #1d4ed8;
  }
  .hemline-toggle:hover { background: #e5e7eb; }

  .hemline-h1b-badge {
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
  .hemline-h1b-badge.low {
    background: #fee2e2;
    color: #991b1b;
    border-color: #fca5a5;
  }

  .hemline-hidden { display: none !important; }
`)

// ─── Feature 1: Action Buttons (Resume / Resume & CL) ────────────────────────
function getDrawerContext(cfg) {
  if (cfg.slug === 'universal') {
    return {
      companyName: getUniversalCompany(),
      jobTitle:    getUniversalTitle()?.textContent?.trim() ?? document.title,
    }
  }
  if (cfg.drawerCompanyHeader) {
    const drawerHeader = findFirst(cfg.drawerCompanyHeader)
    const anchor = drawerHeader?.querySelector('a[href*="/company/"]')
    return {
      companyName: anchor?.textContent.trim() ?? '',
      jobTitle:    findFirst(cfg.drawerJobTitle)?.textContent.trim() ?? '',
    }
  }
  return {
    companyName: cfg.companyName ? findFirst(cfg.companyName)?.textContent.trim() ?? '' : '',
    jobTitle:    cfg.jobTitle ? findFirst(cfg.jobTitle)?.textContent.trim() ?? '' : '',
  }
}

function sanitizeForFilename(name) {
  return name.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Company'
}

// All heavy lifting happens in the background worker. A port (rather than a
// one-shot message) lets us send keep-alive pings so Chrome doesn't suspend the
// MV3 service worker during a 20-40 s LLM call.
let bridgePort = null
let bridgeSeq = 0
const bridgePending = new Map()

function getBridgePort() {
  if (bridgePort) return bridgePort
  bridgePort = chrome.runtime.connect({ name: 'hemline' })
  bridgePort.onMessage.addListener((msg) => {
    const pending = bridgePending.get(msg.id)
    if (!pending) return
    bridgePending.delete(msg.id)
    if (msg.ok) pending.resolve(msg.result)
    else {
      let text = msg.error
      if (msg.latexError) text += ` — LaTeX: ${msg.latexError.message}${msg.latexError.line ? ` (line ${msg.latexError.line})` : ''}`
      pending.reject(new Error(text))
    }
  })
  bridgePort.onDisconnect.addListener(() => {
    bridgePort = null
    for (const p of bridgePending.values()) p.reject(new Error('Hemline background restarted; please retry.'))
    bridgePending.clear()
  })
  return bridgePort
}

function callBackground(op, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++bridgeSeq
    const port = getBridgePort()
    const keepAlive = setInterval(() => { try { port.postMessage({ ping: true }) } catch {} }, 20_000)
    bridgePending.set(id, {
      resolve: (v) => { clearInterval(keepAlive); resolve(v) },
      reject: (e) => { clearInterval(keepAlive); reject(e) },
    })
    port.postMessage({ id, op, payload })
  })
}

function callEndpoint(op, payload, options = {}) {
  return callBackground(op, { ...payload, ...options, provider: llmProvider })
}

function applyHealthState() {
  if (hemlineBusy) return
  const buttons = [
    ...findAll('#hemline-btn-row button'),
    ...findAll('#hemline-autofill-btn'),
  ]
  for (const btn of buttons) {
    btn.disabled = !serverUp
    if (!serverUp) {
      if (!btn.dataset.hemlineTitle) btn.dataset.hemlineTitle = btn.title
      btn.title = notReadyReason
    } else if (btn.dataset.hemlineTitle) {
      btn.title = btn.dataset.hemlineTitle
      delete btn.dataset.hemlineTitle
    }
  }
}

async function pingHealth() {
  try {
    const st = await callBackground('STATUS')
    backendMode = st.backend
    serverUp = st.backend === 'local' || (st.hasKey && st.hasResume)
    notReadyReason = !st.hasKey
      ? 'Hemline: add an API key on the options page'
      : 'Hemline: import your resume on the options page'
  } catch {
    serverUp = false
    notReadyReason = 'Hemline background unavailable — reload the extension'
  }
  applyHealthState()
}

async function confirmNotDuplicate(companyName, jobTitle) {
  try {
    const d = await callBackground('CHECK_DUPLICATE', { company: companyName, title: jobTitle })
    if (d.duplicate) {
      return confirm(`Hemline: already applied to ${companyName} on ${d.lastDate} (${d.timesApplied}x in the last 30 days). Generate anyway?`)
    }
  } catch { /* check unavailable — never block generation */ }
  return true
}

async function loadStoredPdf(name) {
  try {
    const b64 = await callBackground('GET_PDF', { name })
    if (!b64) return null
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: 'application/pdf' })
  } catch {
    return null
  }
}

function makePillButton(text, tooltip) {
  const btn = document.createElement('button')
  btn.textContent = text
  btn.title = tooltip
  btn.className = 'rounded-md px-3 py-1.5 text-xs font-medium border border-border-soft transition-colors hover:bg-border-soft cursor-pointer'
  return btn
}

function injectActionButtons(cfg) {
  if (document.getElementById('hemline-btn-row')) return

  const jdEl = cfg.slug === 'universal' ? findUniversalElements() : findFirst(cfg.jobDescription)
  if (!jdEl) return

  const { companyName: ctxCompany, jobTitle: ctxTitle } = getDrawerContext(cfg)
  const jobId = (ctxCompany && ctxTitle) ? `${ctxCompany}::${ctxTitle}` : getJobId()
  const jobState = JOB_STATES[jobId] ?? {}

  const wrapper = document.createElement('div')
  wrapper.id = 'hemline-btn-row'
  wrapper.className = 'hemline-btn-row'

  const btnResume  = makePillButton('Resume', 'Tailor Resume')
  const btnBoth    = makePillButton('Resume & CL', 'Tailor Resume & Cover Letter')
  const btnMessage = makePillButton('Message', 'Generate LinkedIn Recruiter Outreach')
  const btnEmail   = makePillButton('Email', 'Generate Recruiter Cold Email')

  if (jobState.resume === 'done') {
    btnResume.textContent = jobState.resumeFilename
      ? `${jobState.resumeFilename} ✓`
      : `Resume Downloaded ✓ (${jobState.resumeElapsed}s)`
  }
  if (jobState.both === 'done') {
    btnBoth.textContent = jobState.resumeFilename
      ? `${jobState.resumeFilename} + CL ✓`
      : `Both Downloaded ✓ (${jobState.bothElapsed}s total)`
  }
  if (jobState.message === 'done') btnMessage.textContent = 'Copied ✓'
  if (jobState.email === 'done') btnEmail.textContent = 'Email Opened ✓'

  function setBusy(busy) {
    hemlineBusy = busy
    btnResume.disabled  = busy
    btnBoth.disabled    = busy
    btnMessage.disabled = busy
    btnEmail.disabled   = busy
    if (!busy) applyHealthState()
  }

  const setBothBusy = setBusy
  const setAllBusy = setBusy

  btnResume.addEventListener('click', async () => {
    const jobDescription = jdEl.innerText.trim()
    if (!jobDescription) { alert('Hemline: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)
    if (companyName && !(await confirmNotDuplicate(companyName, jobTitle))) return

    const t0 = performance.now()
    let timerInterval = setInterval(() => {
      btnResume.textContent = `Tailoring… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setBusy(true)
    try {
      const { filename: resumeFilename, matchScore } = await callEndpoint('TAILOR', { jobDescription, companyName, jobTitle })
      clearInterval(timerInterval); timerInterval = null
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], resume: 'done', resumeElapsed: elapsed, resumeFilename }
      persistJobStates()
      btnResume.textContent = matchScore != null
        ? `Resume ✓ ${matchScore}% match (${elapsed}s)`
        : `Resume Downloaded ✓ (${elapsed}s)`
      setTimeout(() => { btnResume.textContent = resumeFilename + ' ✓' }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`Hemline: ${err.message}`)
      btnResume.textContent = 'Resume'
    } finally {
      clearInterval(timerInterval)
      setBusy(false)
    }
  })

  btnBoth.addEventListener('click', async () => {
    const jobDescription = jdEl.innerText.trim()
    if (!jobDescription) { alert('Hemline: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)
    if (companyName && !(await confirmNotDuplicate(companyName, jobTitle))) return

    const t0 = performance.now()
    let phase = 'Tailoring'
    let timerInterval = setInterval(() => {
      btnBoth.textContent = `${phase}… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setBothBusy(true)
    try {
      const { filename: resumeFilename } = await callEndpoint('TAILOR', { jobDescription, companyName, jobTitle })
      // 2.5s stagger prevents concurrent-connection 429 blocks on free API tiers.
      await sleep(2500)
      phase = 'Writing CL'
      await callEndpoint('COVER_LETTER', { jd: jobDescription, companyName, jobTitle })
      clearInterval(timerInterval); timerInterval = null
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], both: 'done', bothElapsed: elapsed, resumeFilename }
      persistJobStates()
      btnBoth.textContent = `Both Downloaded ✓ (${elapsed}s total)`
      setTimeout(() => { btnBoth.textContent = `${resumeFilename} + CL ✓` }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`Hemline: ${err.message}`)
      btnBoth.textContent = 'Resume & CL'
    } finally {
      clearInterval(timerInterval)
      setBothBusy(false)
    }
  })

  btnMessage.addEventListener('click', async () => {
    const jd = findFirst(cfg.jobDescription)?.innerText.trim()
    if (!jd) { alert('Hemline: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)

    const t0 = performance.now()
    let timerInterval = setInterval(() => {
      btnMessage.textContent = `Writing… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setAllBusy(true)
    try {
      const { message } = await callEndpoint('COLD_MESSAGE', { jd, companyName, jobTitle })
      clearInterval(timerInterval); timerInterval = null
      await navigator.clipboard.writeText(message)
      if (companyName) {
        const q = encodeURIComponent(`recruiter AND "${companyName}"`)
        window.open(`https://www.linkedin.com/search/results/people/?keywords=${q}`, '_blank', 'noopener')
      }
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], message: 'done' }
      persistJobStates()
      btnMessage.textContent = 'Copied ✓'
      setTimeout(() => { btnMessage.textContent = 'Message' }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`Hemline: ${err.message}`)
      btnMessage.textContent = 'Message'
    } finally {
      clearInterval(timerInterval)
      setAllBusy(false)
    }
  })

  btnEmail.addEventListener('click', async () => {
    const jd = findFirst(cfg.jobDescription)?.innerText.trim()
    if (!jd) { alert('Hemline: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)

    const t0 = performance.now()
    let timerInterval = setInterval(() => {
      btnEmail.textContent = `Writing… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setBusy(true)
    try {
      const { subject, body } = await callEndpoint('COLD_EMAIL', { jd, companyName, jobTitle })
      clearInterval(timerInterval); timerInterval = null
      window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank')
      JOB_STATES[jobId] = { ...JOB_STATES[jobId], email: 'done' }
      persistJobStates()
      btnEmail.textContent = 'Email Opened ✓'
      setTimeout(() => { btnEmail.textContent = 'Email' }, 3000)
    } catch (err) {
      clearInterval(timerInterval); timerInterval = null
      alert(`Hemline: ${err.message}`)
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
  const target = cfg.injectTarget ? findFirst(cfg.injectTarget) : jdEl
  target?.insertAdjacentElement(cfg.injectPosition ?? 'beforebegin', wrapper)
  applyHealthState()
}

// ─── Feature: ATS Easy Apply Auto-Filler (Greenhouse / Lever / Workday) ──────
const ATS_SLUGS = ['greenhouse', 'lever', 'workday', 'ashby', 'icims', 'smartrecruiters', 'bamboohr', 'jazzhr', 'rippling']

// Order matters: more specific patterns must precede broad ones (e.g. salary.*min
// before any generic salary match, state.*abbr before plain state). EEO fields
// resolve to '' by default and are skipped by the blank guard in autoFillForm.
const FIELD_PATTERNS = [
  { re: /first[\s_-]?name|legalNameSection_firstName/i, value: () => PROFILE.firstName },
  { re: /last[\s_-]?name|legalNameSection_lastName/i,   value: () => PROFILE.lastName },
  { re: /full[\s_-]?name|^name$|your[\s_-]?name/i,      value: () => PROFILE.fullName },
  { re: /e-?mail/i,                                     value: () => PROFILE.email },
  { re: /phone|mobile/i,                                value: () => PROFILE.phone },
  { re: /linked[\s_-]?in/i,                             value: () => PROFILE.linkedin },
  { re: /github|portfolio|website/i,                    value: () => PROFILE.github },
  { re: /skills/i,                                      value: () => PROFILE.skills },
  { re: /\bstate\b.*(abbr|code)|(abbr|code).*\bstate\b/i, value: () => PROFILE.stateAbbr },
  { re: /city|municipality/i,                           value: () => PROFILE.city },
  { re: /country|nation/i,                              value: () => PROFILE.country },
  { re: /zip|postal/i,                                  value: () => PROFILE.zip },
  { re: /\bstate\b|province|region/i,                   value: () => PROFILE.state },
  { re: /sponsor/i,                                     value: () => PROFILE.requireSponsorship },
  { re: /work.*auth|authorization|visa|eligib|citizenship/i, value: () => PROFILE.workAuthorization },
  { re: /years.*exp|experience.*years/i,                value: () => PROFILE.yearsExperience },
  { re: /education.*level|highest.*degree|degree.*level/i, value: () => PROFILE.educationLevel },
  { re: /major|field.*study|degree.*program/i,         value: () => PROFILE.major },
  { re: /universit|college|school/i,                    value: () => PROFILE.university },
  { re: /grad(?:uation)?.*year|class.*of/i,            value: () => PROFILE.graduationYear },
  { re: /\bgpa\b|grade.*point/i,                        value: () => PROFILE.gpa },
  { re: /start.*date|available|earliest/i,             value: () => PROFILE.startDate },
  { re: /salary.*min|minimum.*salary|comp.*min/i,      value: () => PROFILE.salaryMin },
  { re: /salary.*max|maximum.*salary|comp.*max|expected.*salary|desired.*salary|salary/i, value: () => PROFILE.salaryMax },
  { re: /\bgender\b/i,                                  value: () => PROFILE.gender },
  { re: /\brace\b|ethnicity/i,                          value: () => PROFILE.race },
  { re: /veteran/i,                                     value: () => PROFILE.veteranStatus },
]

function fieldDescriptor(el) {
  const label = el.labels?.[0]?.textContent
    ?? (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null)
    ?? ''
  return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-automation-id'), label]
    .filter(Boolean)
    .join(' ')
}

// React replaces the input's value setter with a fiber-aware shim, so plain
// assignment never reaches its state tracker. Calling the native prototype
// setter then dispatching InputEvent makes React/Workday register the change.
function setFieldValue(el, value) {
  el.focus()
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (nativeSetter) nativeSetter.call(el, value)
  else el.value = value
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.blur()
}

// Fuzzy-match a profile value against a <select>'s options: exact text/value match
// first, then best substring overlap. Skips placeholder/disabled options.
function setSelectValue(el, value) {
  const norm = v => v.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const target = norm(value)
  if (!target) return false
  let best = null
  let bestScore = 0
  for (const opt of el.options) {
    if (opt.disabled || !opt.value) continue
    const optText = norm(opt.text)
    const optVal = norm(opt.value)
    if (optText === target || optVal === target) { best = opt; break }
    if (optText && (optText.includes(target) || target.includes(optText))) {
      const score = Math.min(optText.length, target.length) / Math.max(optText.length, target.length)
      if (score > bestScore) { bestScore = score; best = opt }
    }
  }
  if (!best) return false
  el.focus()
  el.value = best.value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.blur()
  return true
}

// Radios share a name; pick the one whose value or label text matches the profile value.
function fillRadioGroup(radios, value) {
  const norm = v => v.toLowerCase().trim()
  const target = norm(value)
  for (const radio of radios) {
    const label = norm(fieldDescriptor(radio))
    if (norm(radio.value) === target || label.includes(target)) {
      radio.focus()
      radio.checked = true
      radio.dispatchEvent(new Event('change', { bubbles: true }))
      radio.blur()
      return true
    }
  }
  return false
}

async function autoFillForm(root = document) {
  let filled = 0

  // Text-like inputs and textareas
  findAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea', root).forEach(el => {
    if (el.value) return
    const desc = fieldDescriptor(el)
    if (!desc) return
    const match = FIELD_PATTERNS.find(p => p.re.test(desc))
    if (!match) return
    const val = match.value()
    if (!val) return
    setFieldValue(el, val)
    filled++
  })

  // <select> dropdowns — skip if a non-placeholder option is already chosen
  findAll('select', root).forEach(el => {
    if (el.value && el.value !== el.options[0]?.value) return
    const desc = fieldDescriptor(el)
    if (!desc) return
    const match = FIELD_PATTERNS.find(p => p.re.test(desc))
    if (!match) return
    const val = match.value()
    if (!val) return
    if (setSelectValue(el, val)) filled++
  })

  // Radio buttons — group by name, fill once per unanswered group
  const radioGroups = {}
  findAll('input[type="radio"]', root).forEach(el => {
    const key = el.name || el.getAttribute('data-name') || el.id
    if (!key) return
    ;(radioGroups[key] ??= []).push(el)
  })
  for (const radios of Object.values(radioGroups)) {
    if (radios.some(r => r.checked)) continue
    const desc = fieldDescriptor(radios[0])
    if (!desc) continue
    const match = FIELD_PATTERNS.find(p => p.re.test(desc))
    if (!match) continue
    const val = match.value()
    if (!val) continue
    if (fillRadioGroup(radios, val)) filled++
  }

  // Checkboxes — only auto-check consent/agreement boxes, never demographic ones
  findAll('input[type="checkbox"]', root).forEach(el => {
    if (el.checked) return
    if (/agree|consent|terms|privacy|authorize/i.test(fieldDescriptor(el))) {
      el.focus()
      el.checked = true
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.blur()
      filled++
    }
  })

  filled += await fillResumeUpload(root)
  return filled
}

// Loads the last-compiled master resume from the bridge server and injects it into
// any empty PDF file input via DataTransfer (the only way to set input.files in JS).
async function fillResumeUpload(root = document) {
  const fileInputs = findAll('input[type="file"]', root)
    .filter(el => !el.files?.length && (!el.accept || el.accept.toLowerCase().includes('pdf')))
  if (!fileInputs.length) return 0

  const blob = await loadStoredPdf('resume')
  if (!blob) return 0

  const name = PROFILE.firstName ? `${sanitizeForFilename(`${PROFILE.firstName} ${PROFILE.lastName}`)}_Resume.pdf` : 'Resume.pdf'
  const file = new File([blob], name, { type: 'application/pdf' })
  let filled = 0
  for (const el of fileInputs) {
    try {
      const dt = new DataTransfer()
      dt.items.add(file)
      el.files = dt.files
      el.dispatchEvent(new Event('change', { bubbles: true }))
      filled++
    } catch { /* DataTransfer unavailable in this context */ }
  }
  return filled
}

function injectAutoFillButton() {
  if (document.getElementById('hemline-autofill-btn')) return

  const form = findFirst('form')
  if (!form) return

  const btn = makePillButton('Auto-Fill', 'Fill profile details and attach your resume to this application form')
  btn.id = 'hemline-autofill-btn'
  btn.addEventListener('click', async (e) => {
    e.preventDefault()
    btn.textContent = 'Filling…'
    const filled = await autoFillForm()
    btn.textContent = filled > 0 ? `Auto-Filled ${filled} fields ✓` : 'No empty fields matched'
    if (filled > 0) highlightNextButton()
    setTimeout(() => { btn.textContent = 'Auto-Fill' }, 3000)
  })
  form.insertAdjacentElement('beforebegin', btn)
}

// Multi-step forms have a Next/Continue that advances rather than submits. After a
// fill we highlight it so the user can review and advance — we never auto-submit.
const NEXT_BTN_RE = /\bnext\b|\bcontinue\b|\bproceed\b|\breview\b/i
const SUBMIT_BTN_RE = /\bsubmit\b|\bapply\b|\bsend\b/i

function highlightNextButton(root = document) {
  const btn = findAll('button, a[role="button"]', root)
    .find(el => NEXT_BTN_RE.test(el.textContent) && !SUBMIT_BTN_RE.test(el.textContent))
  if (!btn) return
  btn.style.outline = '3px solid #10b981'
  btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  setTimeout(() => { btn.style.outline = '' }, 3000)
}

// ─── Feature: LinkedIn Easy Apply Auto-Fill ──────────────────────────────────
// Easy Apply opens a modal long after document_idle, and its content reloads in
// waves as the user steps through the flow — so we watch for it and fill the
// modal (scoped, never the page behind it) on a debounce instead of via a button.
const LI_EASY_APPLY_MODAL = '[class*="jobs-easy-apply-modal"], [class*="easy-apply-content"]'

function watchLinkedInEasyApply() {
  if (document.body.dataset.hemlineLiWatcher) return
  document.body.dataset.hemlineLiWatcher = '1'

  let fillTimer = null
  const observer = new MutationObserver(() => {
    const modal = findFirst(LI_EASY_APPLY_MODAL)
    if (!modal) return
    clearTimeout(fillTimer)
    fillTimer = setTimeout(async () => {
      const filled = await autoFillForm(modal)
      if (filled > 0) highlightNextButton(modal)
    }, 400)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

// ─── Feature: Universal Semantic Scraper (unmapped hosts) ────────────────────
const JD_KEYWORDS = [
  'requirements', 'responsibilities', 'qualifications', "what you'll do",
  'benefits', 'about the role', "what we're looking for", 'you will',
  'experience', 'skills', 'must have', 'nice to have',
]

function scoreElement(el) {
  const text = el.innerText || ''
  const len = text.length
  if (len < 200 || len > 20000) return 0
  const density = len / (el.innerHTML.length || 1)
  const lower = text.toLowerCase()
  const hits = JD_KEYWORDS.filter(k => lower.includes(k)).length
  return density * hits * Math.log(len)
}

function findUniversalElements() {
  let best = null
  let bestScore = 0
  for (const el of document.querySelectorAll('section, article, div, main')) {
    const score = scoreElement(el)
    if (score > bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

function getUniversalTitle() {
  return document.querySelector('h1') ?? document.querySelector('h2') ?? null
}

function getUniversalCompany() {
  return document.querySelector('meta[property="og:site_name"]')?.content
    ?? document.querySelector('[class*="company"], [id*="company"]')?.textContent?.trim()
    ?? ''
}

// ─── Feature 2: Enhanced Seniority Filter ────────────────────────────────────
function injectSeniorityFilter(sidebar) {
  if (document.getElementById('hemline-seniority-toggle')) return

  const btn = makeToggleButton('hemline-seniority-toggle', '🎓 Enhanced Early Career')
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
      card.classList.remove('hemline-hidden')
      return
    }

    if (SENIOR_RE.test(title)) {
      card.classList.add('hemline-hidden')
    } else {
      card.classList.remove('hemline-hidden')
    }
  })
}

// ─── Feature 3: H1-B Badges & Filter ─────────────────────────────────────────
function injectH1bBadges() {
  findAll(activeCfg.companyName).forEach(el => {
    if (el.querySelector('.hemline-h1b-badge')) return

    const company = el.textContent.trim()
    const count = lookupH1b(company)
    if (count === null) return

    const badge = document.createElement('span')
    badge.className = 'hemline-h1b-badge' + (count < H1B_THRESHOLD ? ' low' : '')
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
  if (document.getElementById('hemline-h1b-toggle')) return

  const btn = makeToggleButton('hemline-h1b-toggle', '🌐 H1-B Sponsors Only')
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
      if (!seniorityFilterActive) card.classList.remove('hemline-hidden')
      return
    }

    const companyEl = findFirst(activeCfg.companyName, card)
    const company = companyEl?.textContent.trim() ?? ''
    const count = lookupH1b(company)

    if (count === null || count < H1B_THRESHOLD) {
      card.classList.add('hemline-hidden')
    } else if (!seniorityFilterActive) {
      card.classList.remove('hemline-hidden')
    }
  })
}

// ─── Feature 5: LLM Provider Toggle ──────────────────────────────────────────
// Only meaningful with the optional local dev server; extension mode routes
// through the user's own API keys configured on the options page.
function injectLlmToggle(sidebar) {
  if (backendMode !== 'local') return
  if (document.getElementById('hemline-llm-toggle')) return

  const btn = makeToggleButton('hemline-llm-toggle', llmProvider === 'relay' ? '⚡ LLM: Relay (Local)' : '⚡ LLM: Claude')
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

// ─── Feature 6: Batch Apply Toggle ───────────────────────────────────────────
function injectBatchApplyToggle(sidebar) {
  if (document.getElementById('hemline-batch-toggle')) return

  const btn = makeToggleButton('hemline-batch-toggle', '📋 Batch Apply')
  btn.title = 'Enable batch job selection and one-click multi-apply'
  btn.dataset.active = String(batchApplyActive)

  btn.addEventListener('click', () => {
    batchApplyActive = !batchApplyActive
    btn.dataset.active = String(batchApplyActive)
    chrome.storage.local.set({ batchApplyEnabled: batchApplyActive })

    if (!batchApplyActive) {
      findAll('.hemline-select-box').forEach(el => el.remove())
      document.getElementById('hemline-apply-bar')?.remove()
      selectedJobs.clear()
    } else {
      injectJobSelection(activeCfg)
    }
  })

  sidebar.prepend(btn)
}

// ─── Feature 4: LinkedIn Recruiter Finder ────────────────────────────────────
function injectLinkedInButtons() {
  findAll(activeCfg.companyName).forEach(el => {
    if (el.querySelector('.hemline-li-btn')) return

    const company = el.textContent.replace(/H1-B:.*$/i, '').trim()
    if (!company) return

    const btn = document.createElement('span')
    btn.className = 'hemline-li-btn'
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

  if (drawerHeader.dataset.hemlineCompany === company) return
  drawerHeader.dataset.hemlineCompany = company
  drawerHeader.querySelector('.hemline-h1b-badge')?.remove()
  drawerHeader.querySelector('.hemline-li-btn')?.remove()

  const count = lookupH1b(company)
  if (count !== null) {
    const badge = document.createElement('span')
    badge.className = 'hemline-h1b-badge' + (count < H1B_THRESHOLD ? ' low' : '')
    badge.textContent = `H1-B: ${count.toLocaleString()}`
    badge.title = `${company} sponsored ${count.toLocaleString()} H1-B visas (historical)`
    anchor.insertAdjacentElement('afterend', badge)
  }

  const liBtn = document.createElement('span')
  liBtn.className = 'hemline-li-btn'
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

// ─── Feature: 1-Click Batch Apply (jseek.co watchlist) ─────────────────────────
// CLEAN_ATS auto-submit; everything else fills and stops at review.
const CLEAN_ATS = ['greenhouse', 'lever', 'ashby']

const selectedJobs = new Map()
const progressJobs = new Map()

injectStyle(`
  /* jseek.co cards carry an absolute inset-0 overlay button that intercepts every
     click — position:relative + a high z-index lifts our checkbox above it so
     manual toggles actually land on the input. */
  .hemline-select-box {
    position: relative;
    z-index: 20;
    display: inline-flex;
    align-items: center;
    margin-right: 8px;
    flex-shrink: 0;
  }
  .hemline-select-box input { position: relative; z-index: 20; width: 16px; height: 16px; cursor: pointer; accent-color: #3b82f6; }

  #hemline-apply-bar {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 2147483646;
    width: 280px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    font-family: system-ui, sans-serif;
    font-size: 13px;
    color: #111827;
    overflow: hidden;
  }
  #hemline-apply-bar .hemline-bar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
    font-weight: 600;
  }
  #hemline-apply-bar .hemline-bar-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; }
  #hemline-apply-bar button {
    flex: 1 1 auto;
    padding: 6px 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #f3f4f6;
    font-size: 12px;
    font-weight: 600;
    color: #374151;
    cursor: pointer;
  }
  #hemline-apply-bar button.primary { background: #2563eb; border-color: #2563eb; color: #fff; flex-basis: 100%; }
  #hemline-apply-bar button:disabled { opacity: 0.5; cursor: not-allowed; }
  #hemline-apply-bar .hemline-skip { display: flex; align-items: center; gap: 6px; padding: 0 12px 8px; font-size: 12px; color: #6b7280; }
  #hemline-apply-progress { max-height: 200px; overflow-y: auto; border-top: 1px solid #e5e7eb; }
  #hemline-apply-progress:empty { display: none; }
  .hemline-prog-row { display: flex; justify-content: space-between; gap: 8px; padding: 6px 12px; border-bottom: 1px solid #f3f4f6; }
  .hemline-prog-row .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hemline-prog-row .s { flex-shrink: 0; font-weight: 600; font-size: 11px; }
  .hemline-prog-row .s.submitted { color: #047857; }
  .hemline-prog-row .s.needs_review { color: #b45309; }
  .hemline-prog-row .s.failed, .hemline-prog-row .s.duplicate { color: #b91c1c; }
`)

function showParam() {
  return new URLSearchParams(location.search).get('show')
}

// The watchlist card holds no apply URL — it only opens a drawer (?show={id})
// that renders the real external ATS link, which jseek.co tags with
// utm_source=jobseek. So pick the jobseek-tagged external link, else the first
// non-jseek.co http link the drawer rendered.
function findDrawerApplyUrl() {
  const externals = findAll('a[href]').filter(a => {
    try { return /^https?:/.test(a.href) && new URL(a.href).hostname !== 'jseek.co' } catch { return false }
  })
  if (!externals.length) return null
  const tagged = externals.find(a => /utm_source=jobseek/i.test(a.href))
  return (tagged ?? externals[0]).href
}

// Click the card's overlay button to open its drawer, wait for ?show to switch
// to this job and the external apply link to render, then read it off.
async function resolveCardApplyUrl(card) {
  const overlay = card.querySelector('button[aria-label]')
  if (!overlay) return null
  const prevShow = showParam()
  overlay.click()
  const start = Date.now()
  while (Date.now() - start < 8000) {
    await sleep(250)
    const show = showParam()
    if (!show || show === prevShow) continue
    const url = findDrawerApplyUrl()
    if (url) return url
  }
  return findDrawerApplyUrl()
}

function getCardInfo(card, cfg) {
  const title = findFirst(cfg.jobTitle, card)?.textContent.trim() ?? ''
  const company = findFirst(cfg.companyName, card)?.textContent.replace(/H1-B:.*$/i, '').trim() ?? ''
  return { id: `${company}::${title}`, title, company }
}

function injectJobSelection(cfg) {
  const cards = findAll(cfg.jobCards)
  if (!cards.length) return

  for (const card of cards) {
    try {
    if (card.querySelector('.hemline-select-box')) {
      // Re-sync checkbox state after a React re-render reused the node.
      const box = card.querySelector('.hemline-select-box input')
      if (box) box.checked = selectedJobs.has(card.dataset.hemlineKey)
      continue
    }
    const info = getCardInfo(card, cfg)
    card.dataset.hemlineKey = info.id

    const wrap = document.createElement('label')
    // relative + z-20 mirror the CSS stacking lift in Tailwind terms, in case
    // the page's utility classes win specificity over our injected stylesheet.
    wrap.className = 'hemline-select-box relative z-20'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'relative z-20'
    box.checked = selectedJobs.has(info.id)
    box.title = 'Select for batch apply'
    // Swallow the event on every phase the card overlay listens to so toggling
    // never bubbles up and triggers the drawer.
    const stop = e => { e.stopPropagation(); e.stopImmediatePropagation() }
    for (const evt of ['pointerdown', 'mousedown', 'click']) {
      wrap.addEventListener(evt, stop)
      box.addEventListener(evt, stop)
    }
    box.addEventListener('change', () => {
      if (box.checked) selectedJobs.set(info.id, getCardInfo(card, cfg))
      else selectedJobs.delete(info.id)
      updateApplyBar()
    })
    wrap.appendChild(box)
    card.prepend(wrap)
    } catch (err) {
      // One malformed card must not break injection for the rest of the list.
      console.warn('Hemline: skipped a watchlist card', err)
    }
  }
  ensureApplyBar()
  updateApplyBar()
}

function ensureApplyBar() {
  if (document.getElementById('hemline-apply-bar')) return

  const bar = document.createElement('div')
  bar.id = 'hemline-apply-bar'
  bar.innerHTML = `
    <div class="hemline-bar-head"><span>Batch Apply</span><span id="hemline-apply-count">0 selected</span></div>
    <div class="hemline-skip"><input type="checkbox" id="hemline-skip-tailor"><label for="hemline-skip-tailor">Skip tailoring (use master resume)</label></div>
    <div class="hemline-bar-actions">
      <button id="hemline-apply-go" class="primary">Apply to 0 selected</button>
      <button id="hemline-apply-all">Select visible</button>
      <button id="hemline-apply-clear">Clear</button>
      <button id="hemline-apply-pause" style="display:none">Pause</button>
      <button id="hemline-apply-stop" style="display:none">Stop</button>
    </div>
    <div id="hemline-apply-progress"></div>`
  document.body.appendChild(bar)

  bar.querySelector('#hemline-apply-go').addEventListener('click', startApplyQueue)
  bar.querySelector('#hemline-apply-all').addEventListener('click', () => {
    findAll(activeCfg.jobCards).forEach(card => {
      const box = card.querySelector('.hemline-select-box input')
      if (box && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change')) }
    })
  })
  bar.querySelector('#hemline-apply-clear').addEventListener('click', () => {
    selectedJobs.clear()
    findAll('.hemline-select-box input').forEach(b => { b.checked = false })
    updateApplyBar()
  })
  bar.querySelector('#hemline-apply-pause').addEventListener('click', e => {
    const paused = e.target.dataset.paused === 'true'
    chrome.runtime.sendMessage({ type: paused ? 'RESUME_QUEUE' : 'PAUSE_QUEUE' })
    e.target.dataset.paused = String(!paused)
    e.target.textContent = paused ? 'Pause' : 'Resume'
  })
  bar.querySelector('#hemline-apply-stop').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_QUEUE' })
  })
}

function updateApplyBar() {
  const count = selectedJobs.size
  const countEl = document.getElementById('hemline-apply-count')
  const goEl = document.getElementById('hemline-apply-go')
  if (countEl) countEl.textContent = `${count} selected`
  if (goEl) { goEl.textContent = `Apply to ${count} selected`; goEl.disabled = count === 0 || !serverUp }
}

function setQueueRunning(running) {
  const pause = document.getElementById('hemline-apply-pause')
  const stop = document.getElementById('hemline-apply-stop')
  const go = document.getElementById('hemline-apply-go')
  if (pause) pause.style.display = running ? '' : 'none'
  if (stop) stop.style.display = running ? '' : 'none'
  if (go) go.disabled = running || selectedJobs.size === 0
}

async function startApplyQueue() {
  if (!selectedJobs.size || !serverUp) return
  const jobs = [...selectedJobs.values()]
  progressJobs.clear()
  for (const job of jobs) { job.status = 'queued'; progressJobs.set(job.id, job) }
  renderProgress()
  setQueueRunning(true)

  console.log('[Hemline] starting batch apply for', jobs.length, 'jobs')

  const ready = []
  for (const job of jobs) {
    job.status = 'resolving'
    renderProgress()
    const card = findAll(activeCfg.jobCards).find(c => c.dataset.hemlineKey === job.id)
    const url = card ? await resolveCardApplyUrl(card) : null
    console.log('[Hemline] resolved', job.company, '—', job.title, '→', url)
    if (!url) {
      job.status = 'failed'
      job.error = card ? 'no apply link in drawer' : 'card not found'
      renderProgress()
      continue
    }
    let dup = false
    try {
      dup = (await callBackground('CHECK_DUPLICATE', { company: job.company, title: job.title })).duplicate
    } catch { /* check unavailable — don't block */ }
    if (dup) { job.status = 'duplicate'; renderProgress(); continue }
    ready.push({ id: job.id, title: job.title, company: job.company, applyUrl: url })
  }

  if (!ready.length) { setQueueRunning(false); return }
  const skipTailoring = document.getElementById('hemline-skip-tailor')?.checked ?? false
  chrome.runtime.sendMessage({ type: 'START_APPLY_QUEUE', jobs: ready, policy: { skipTailoring, provider: llmProvider } })
}

function renderProgress() {
  const box = document.getElementById('hemline-apply-progress')
  if (!box) return
  box.textContent = ''
  for (const job of progressJobs.values()) {
    const row = document.createElement('div')
    row.className = 'hemline-prog-row'

    const t = document.createElement('span')
    t.className = 't'
    t.textContent = job.title || job.company || job.id
    if (job.error) t.title = job.error

    const s = document.createElement('span')
    s.className = `s ${job.status}`
    // Surface the failure reason inline (e.g. "failed: no apply URL") so it's
    // actionable instead of a bare "failed".
    s.textContent = job.error ? `${job.status}: ${job.error}` : job.status
    if (job.error) s.title = job.error

    row.append(t, s)
    box.appendChild(row)
  }
}

function onQueueProgress(msg) {
  for (const j of msg.jobs) {
    const existing = progressJobs.get(j.id) ?? {}
    progressJobs.set(j.id, { ...existing, ...j })
  }
  renderProgress()
  if (msg.done) setQueueRunning(false)
}

// ─── Apply-mode flow (runs inside a queue-opened ATS tab) ────────────────────
function reportApplyProgress(jobId, status) {
  chrome.runtime.sendMessage({ type: 'APPLY_PROGRESS', jobId, status }).catch(() => {})
}

async function waitForForm(timeout = 15_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const form = findFirst('form')
    if (form && findAll('input, select, textarea', form).length) return form
    await sleep(500)
  }
  return findFirst('form')
}

function hasCoverLetterField(root = document) {
  return findAll('input[type="file"], textarea', root).some(el => /cover.?letter/i.test(fieldDescriptor(el)))
}

async function fillCoverLetterUpload(root = document) {
  const inputs = findAll('input[type="file"]', root)
    .filter(el => !el.files?.length && /cover.?letter/i.test(fieldDescriptor(el)))
  if (!inputs.length) return 0
  const blob = await loadStoredPdf('coverLetter')
  if (!blob) return 0
  const file = new File([blob], 'cover_letter.pdf', { type: 'application/pdf' })
  let filled = 0
  for (const el of inputs) {
    try {
      const dt = new DataTransfer()
      dt.items.add(file)
      el.files = dt.files
      el.dispatchEvent(new Event('change', { bubbles: true }))
      filled++
    } catch { /* DataTransfer unavailable */ }
  }
  return filled
}

function clickSubmit(root = document) {
  const btn = findAll('button, input[type="submit"], a[role="button"]', root)
    .find(el => SUBMIT_BTN_RE.test(el.textContent || el.value || '') && !NEXT_BTN_RE.test(el.textContent || ''))
  if (!btn) return false
  btn.scrollIntoView({ block: 'center' })
  btn.click()
  return true
}

async function runApplyFlow(job, policy) {
  const cfg = activeCfg ?? detectSite()
  const slug = cfg?.slug ?? 'universal'

  reportApplyProgress(job.id, 'filling')
  const form = await waitForForm()
  if (!form) return { status: 'failed', error: 'no application form found' }

  const jdEl = slug === 'universal' ? findUniversalElements() : findFirst(cfg.jobDescription)
  const jd = jdEl?.innerText.trim() ?? ''

  if (!policy.skipTailoring && jd) {
    reportApplyProgress(job.id, 'tailoring')
    try { await callEndpoint('TAILOR', { jobDescription: jd, companyName: job.company, jobTitle: job.title }, { download: false }) } catch { /* fall back to last resume */ }
  }

  if (hasCoverLetterField() && jd) {
    reportApplyProgress(job.id, 'cover letter')
    try { await callEndpoint('COVER_LETTER', { jd, companyName: job.company, jobTitle: job.title }, { download: false }) } catch { /* skip CL on failure */ }
    await fillCoverLetterUpload()
  }

  reportApplyProgress(job.id, 'filling')
  await autoFillForm()

  // Safety rail: only auto-submit clean ATS; everything else (and unknown
  // hosts) stops at review for the user to finish manually.
  if (CLEAN_ATS.includes(slug) && clickSubmit()) return { status: 'submitted' }
  highlightNextButton()
  return { status: 'needs_review' }
}

// Top-level so RUN_APPLY is answered on ATS tabs and QUEUE_PROGRESS on the
// watchlist, regardless of which site config matched.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'RUN_APPLY') {
    runApplyFlow(msg.job, msg.policy)
      .then(sendResponse)
      .catch(err => sendResponse({ status: 'failed', error: err.message }))
    return true
  }
  if (msg.type === 'QUEUE_PROGRESS') {
    onQueueProgress(msg)
    return false
  }
})

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function loadH1bData() {
  try {
    const url = chrome.runtime.getURL('h1b_data.json')
    const resp = await fetch(url)
    h1bData = await resp.json()
  } catch {
    console.warn('Hemline: failed to load h1b_data.json')
  }
}

function runFeatures(cfg) {
  injectActionButtons(cfg)

  if (ATS_SLUGS.includes(cfg.slug)) injectAutoFillButton()

  if (cfg.slug === 'linkedin') watchLinkedInEasyApply()

  if (cfg.slug === 'jseek') {
    const sidebarContainer = findFirst(cfg.filterSidebar)
    const sidebarPills = sidebarContainer
      ? findFirst(cfg.filterTagPills, sidebarContainer)
      : null

    injectH1bBadges()
    injectLinkedInButtons()
    injectDrawerEnhancements()
    if (batchApplyActive) injectJobSelection(cfg)

    if (sidebarPills) {
      injectSeniorityFilter(sidebarPills)
      injectH1bFilter(sidebarPills)
      injectLlmToggle(sidebarPills)
      injectBatchApplyToggle(sidebarPills)
    }
  }
}

async function init() {
  const cfg = detectSite()
  if (!cfg) return

  activeCfg = cfg

  if (cfg.slug === 'jseek') await loadH1bData()

  await new Promise(resolve => {
    chrome.storage.local.get(['llmProvider', 'profile', 'jobStates', 'batchApplyEnabled'], ({ llmProvider: saved, profile, jobStates, batchApplyEnabled: bae }) => {
      if (saved) llmProvider = saved
      if (profile) {
        PROFILE = { ...DEFAULT_PROFILE, ...profile }
        PROFILE.fullName = `${PROFILE.firstName} ${PROFILE.lastName}`
      }
      if (jobStates) Object.assign(JOB_STATES, jobStates)
      if (bae !== undefined) batchApplyActive = bae
      resolve()
    })
  })

  await pingHealth()
  setInterval(pingHealth, 30_000)

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
