// ─── Site Configs ─────────────────────────────────────────────────────────────
// jseek.co selectors verified against live DevTools — update if Tailwind classes change.
// LinkedIn/Jobright selectors are best-guess based on known DOM patterns; verify in DevTools.
const SITE_CONFIGS = {
  jseek: {
    slug:                'jseek',
    jobDescription:      'div.job-description',
    jobCards:            'div.relative.flex.items-center.gap-3.rounded-md.px-2.py-2[class*="[contain:layout]"]',
    jobTitle:            'span.min-w-0.flex-1.truncate.text-sm',
    companyName:         'span.shrink-0.text-xs.text-muted',
    filterSidebar:       'div.space-y-4.rounded-lg.border.border-border-soft.bg-surface.p-4',
    filterTagPills:      'div.space-y-3',
    drawerCompanyHeader: 'div.flex.items-center.gap-3:has(a[href*="/company/"])',
    drawerJobTitle:      'h2.text-xl, h2.text-lg, h1',
    injectTarget:        'div.job-description',
    injectPosition:      'beforebegin',
  },
  linkedin: {
    slug:                'linkedin',
    jobDescription:      '#job-details',
    jobCards:            null,
    jobTitle:            '.job-details-jobs-unified-top-card__job-title h1',
    companyName:         '.job-details-jobs-unified-top-card__company-name',
    filterSidebar:       null,
    filterTagPills:      null,
    drawerCompanyHeader: null,
    drawerJobTitle:      null,
    injectTarget:        '#job-details',
    injectPosition:      'beforebegin',
  },
  jobright: {
    slug:                'jobright',
    jobDescription:      '[data-testid="job-description"]',
    jobCards:            null,
    jobTitle:            '[data-testid="job-title"], h1',
    companyName:         '[data-testid="company-name"], .company-name',
    filterSidebar:       null,
    filterTagPills:      null,
    drawerCompanyHeader: null,
    drawerJobTitle:      null,
    injectTarget:        '[data-testid="job-description"]',
    injectPosition:      'beforebegin',
  },
}

let activeCfg = null

function detectSite() {
  const host = window.location.hostname
  if (host.includes('jseek.co'))     return SITE_CONFIGS.jseek
  if (host.includes('linkedin.com')) return SITE_CONFIGS.linkedin
  if (host.includes('jobright.ai'))  return SITE_CONFIGS.jobright
  return null
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SERVER = 'http://localhost:4567'
const H1B_THRESHOLD = 50
const ENTRY_RE = /associate|junior|\bII\b|0-3\s*years?|grad(?:uate)?|entry/i
const SENIOR_RE = /\bsenior\b|\blead\b|\bstaff\b/i

// ─── LinkedIn SVG icon ────────────────────────────────────────────────────────
const LI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#0a66c2" style="vertical-align:middle;cursor:pointer;margin-left:6px;flex-shrink:0"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`

// ─── State ────────────────────────────────────────────────────────────────────
let h1bData = {}
let seniorityFilterActive = false
let h1bFilterActive = false

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
    display: inline-flex;
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
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
    throw new Error(err.error ?? resp.statusText)
  }
  return resp.blob()
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

  const wrapper = document.createElement('div')
  wrapper.id = 'jseek-btn-row'
  wrapper.className = 'jseek-btn-row'

  const btnResume  = makePillButton('Resume', 'Tailor Resume')
  const btnBoth    = makePillButton('Resume & CL', 'Tailor Resume & Cover Letter')
  const btnMessage = makePillButton('Message', 'Generate LinkedIn Recruiter Outreach')

  function setBusy(busy) {
    btnResume.disabled  = busy
    btnBoth.disabled    = busy
    btnMessage.disabled = busy
  }

  function setBothBusy(busy) {
    btnResume.disabled  = busy
    btnBoth.disabled    = busy
    btnMessage.disabled = busy
  }

  function setAllBusy(busy) {
    btnResume.disabled  = busy
    btnBoth.disabled    = busy
    btnMessage.disabled = busy
  }

  btnResume.addEventListener('click', async () => {
    const jobDescription = jdEl.innerText.trim()
    if (!jobDescription) { alert('JSeek Enhancer: no job description found.'); return }

    const { companyName, jobTitle } = getDrawerContext(cfg)
    const safe = sanitizeForFilename(companyName)

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
      btnResume.textContent = `Resume Downloaded ✓ (${((performance.now() - t0) / 1000).toFixed(1)}s)`
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

    const t0 = performance.now()
    let timerInterval = setInterval(() => {
      btnBoth.textContent = `Writing CL… ${((performance.now() - t0) / 1000).toFixed(1)}s`
    }, 200)
    setBothBusy(true)
    try {
      const [resumeBlob, clBlob] = await Promise.all([
        callEndpoint('/tailor', { jobDescription, companyName, jobTitle }),
        callEndpoint('/cover-letter', { jd: jobDescription, companyName, jobTitle }),
      ])
      const [resumeDataUrl, clDataUrl] = await Promise.all([blobToDataUrl(resumeBlob), blobToDataUrl(clBlob)])
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_PDF', dataUrl: resumeDataUrl, filename: `Rohan_Resume_${safe}.pdf` })
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_PDF', dataUrl: clDataUrl, filename: `Rohan_CL_${safe}.pdf` })
      clearInterval(timerInterval); timerInterval = null
      btnBoth.textContent = `Both Downloaded ✓ (${((performance.now() - t0) / 1000).toFixed(1)}s total)`
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

  wrapper.appendChild(btnResume)
  wrapper.appendChild(btnBoth)
  wrapper.appendChild(btnMessage)
  findFirst(cfg.injectTarget)?.insertAdjacentElement(cfg.injectPosition, wrapper)
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
    }
  }
}

async function init() {
  const cfg = detectSite()
  if (!cfg) return

  activeCfg = cfg

  if (cfg.slug === 'jseek') await loadH1bData()

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
