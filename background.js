import { tailorResume, writeCoverLetter, writeColdMessage, writeColdEmail } from './pipeline/tailor.js'
import { buildResumeImportPrompt } from './pipeline/prompts.js'
import { extractLatex, sanitizeFilename, extractLatexError, parsePageCount } from './pipeline/latex.js'
import { fillTemplate, fullName } from './pipeline/templates.js'
import { callLlm, callOne } from './llm.js'
import { compileTex } from './tex-engine.js'
import {
  getSettings, isFastMode, appendLedger, checkDuplicate, readLedger, savePdf, loadPdf, bytesToBase64, base64ToBytes,
} from './store.js'

// Background hub for the standalone extension. Content scripts and extension pages
// talk to it over a 'hemline' port (see handleOp). Everything runs locally: the LLM
// call goes straight from here to the user's own provider, and LaTeX compiles in a
// WASM pdfTeX worker. backend === 'local' forwards to the optional dev server.

const LOCAL_SERVER = 'http://localhost:4567'

// ─── LaTeX compile (WASM) ────────────────────────────────────────────────────

let creatingOffscreen = null
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Compile LaTeX resumes with a bundled WASM pdfTeX worker',
  }).finally(() => { creatingOffscreen = null })
  await creatingOffscreen
}

// Firefox's event-page background can host the Worker directly; Chrome's service
// worker cannot, so it delegates to the offscreen document.
async function compile(tex) {
  if (typeof Worker !== 'undefined') return compileTex(tex)
  await ensureOffscreen()
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', op: 'COMPILE_TEX', tex })
  if (!res?.ok) {
    const err = new Error(res?.error ?? 'LaTeX compile failed')
    err.log = res?.log
    throw err
  }
  return { pdf: base64ToBytes(res.pdf), log: res.log }
}

// ─── Downloads ───────────────────────────────────────────────────────────────

// Firefox MV3 denies downloads of raw data: URIs, so we bridge through a blob:
// URL. Chrome MV3 service workers lack URL.createObjectURL but accept data: URIs.
async function downloadPdf(bytes, filename) {
  let url
  let blobUrl = null
  if (typeof URL.createObjectURL === 'function') {
    blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    url = blobUrl
  } else {
    url = `data:application/pdf;base64,${bytesToBase64(bytes)}`
  }
  try {
    return await chrome.downloads.download({ url, filename })
  } finally {
    if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
  }
}

// ─── Per-user context ────────────────────────────────────────────────────────

let defaultTemplates = null
async function loadDefaultTemplates() {
  if (defaultTemplates) return defaultTemplates
  const read = async (p) => (await fetch(chrome.runtime.getURL(p))).text()
  const [resume, coverLetter] = await Promise.all([
    read('templates/resume_template.tex'),
    read('templates/cover_letter_template.tex'),
  ])
  defaultTemplates = { resume, coverLetter }
  return defaultTemplates
}

async function userContext() {
  const s = await getSettings()
  const profile = s.profile ?? {}
  if (!s.resumeTex?.trim()) {
    throw new Error('No resume set up yet. Open the Hemline options page and import your resume first.')
  }
  const name = fullName(profile)
  return {
    settings: s,
    profile,
    candidate: { name, highlights: profile.highlights ?? '' },
    filePrefix: name ? sanitizeFilename(name) : 'Resume',
    callLlm: (prompt) => callLlm(prompt, s.llmKeys, { fast: isFastMode(s) }),
  }
}

// ─── Local dev server passthrough ────────────────────────────────────────────

async function serverPost(endpoint, body) {
  const resp = await fetch(`${LOCAL_SERVER}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
    const e = new Error(err.error ?? resp.statusText)
    e.latexError = err.latexError ?? null
    throw e
  }
  return resp
}

async function viaServer(op, p) {
  const safe = sanitizeFilename(p.companyName)
  switch (op) {
    case 'TAILOR': {
      const resp = await serverPost('/tailor', { jobDescription: p.jobDescription, companyName: p.companyName, jobTitle: p.jobTitle, provider: p.provider })
      return { bytes: new Uint8Array(await resp.arrayBuffer()), matchScore: Number(resp.headers.get('X-Hemline-Match-Score')) || null, filename: `Resume_${safe}.pdf` }
    }
    case 'COVER_LETTER': {
      const resp = await serverPost('/cover-letter', { jd: p.jd, companyName: p.companyName, jobTitle: p.jobTitle, provider: p.provider })
      return { bytes: new Uint8Array(await resp.arrayBuffer()), filename: `CL_${safe}.pdf` }
    }
    case 'COLD_MESSAGE':
      return (await serverPost('/cold-message', { jd: p.jd, companyName: p.companyName, jobTitle: p.jobTitle, provider: p.provider })).json()
    case 'COLD_EMAIL':
      return (await serverPost('/cold-email', { jd: p.jd, companyName: p.companyName, jobTitle: p.jobTitle, provider: p.provider })).json()
  }
  throw new Error(`Unsupported op for local server: ${op}`)
}

// ─── Operations ──────────────────────────────────────────────────────────────

async function tailor(p, { download = true } = {}) {
  const settings = await getSettings()
  let out
  if (settings.backend === 'local') {
    out = await viaServer('TAILOR', p)
  } else {
    const ctx = await userContext()
    const { pdf, match } = await tailorResume({
      jd: p.jobDescription,
      sweTex: ctx.settings.resumeTex,
      skills: ctx.settings.skillPools ?? {},
      projectPool: ctx.settings.projectPool?.trim() || null,
      callLlm: ctx.callLlm,
      compile,
    })
    out = { bytes: pdf, matchScore: match.score, filename: `${ctx.filePrefix}_Resume_${sanitizeFilename(p.companyName)}.pdf` }
  }
  await savePdf('resume', out.bytes)
  if (download) await downloadPdf(out.bytes, out.filename)
  if (p.companyName || p.jobTitle) {
    await appendLedger({ company: p.companyName ?? '', title: p.jobTitle ?? '', resumePath: out.filename, clPath: null })
  }
  return { filename: out.filename, matchScore: out.matchScore }
}

async function coverLetter(p, { download = true } = {}) {
  const settings = await getSettings()
  let out
  if (settings.backend === 'local') {
    out = await viaServer('COVER_LETTER', p)
  } else {
    const ctx = await userContext()
    const template = ctx.settings.clTemplate?.trim() || (await loadDefaultTemplates()).coverLetter
    const { pdf } = await writeCoverLetter({
      jd: p.jd,
      jobTitle: p.jobTitle ?? '',
      companyName: p.companyName ?? '',
      sweTex: ctx.settings.resumeTex,
      clTemplate: fillTemplate(template, ctx.profile),
      skills: ctx.settings.skillPools ?? {},
      candidate: ctx.candidate,
      callLlm: ctx.callLlm,
      compile,
    })
    out = { bytes: pdf, filename: `${ctx.filePrefix}_CL_${sanitizeFilename(p.companyName)}.pdf` }
  }
  await savePdf('coverLetter', out.bytes)
  // Auto-fill attaches this letter only on the same company's form (it names the company).
  await chrome.storage.local.set({ coverLetterMeta: { company: p.companyName ?? '', at: Date.now() } })
  if (download) await downloadPdf(out.bytes, out.filename)
  return { filename: out.filename }
}

async function coldText(op, p) {
  const settings = await getSettings()
  if (settings.backend === 'local') return viaServer(op, p)
  const ctx = await userContext()
  const args = { jd: p.jd, companyName: p.companyName ?? '', jobTitle: p.jobTitle ?? '', sweTex: ctx.settings.resumeTex, candidate: ctx.candidate, callLlm: ctx.callLlm }
  return op === 'COLD_MESSAGE' ? { message: await writeColdMessage(args) } : writeColdEmail(args)
}

async function importResume({ text }) {
  const s = await getSettings()
  const template = fillTemplate((await loadDefaultTemplates()).resume, s.profile ?? {})
  const raw = await callLlm(buildResumeImportPrompt(text, template), s.llmKeys, { fast: isFastMode(s) })
  const tex = extractLatex(raw)
  if (!tex) throw new Error('The model did not return a LaTeX document. Try again or use another key.')
  return { tex, ...(await preview({ tex })) }
}

async function preview({ tex }) {
  try {
    const { pdf, log } = await compile(tex)
    return { pdf: bytesToBase64(pdf), pages: parsePageCount(log) }
  } catch (err) {
    err.latexError ??= extractLatexError(err.log)
    throw err
  }
}

async function status() {
  const s = await getSettings()
  return {
    backend: s.backend ?? 'extension',
    hasKey: (s.llmKeys ?? []).some(k => k?.key?.trim()),
    hasResume: Boolean(s.resumeTex?.trim()),
  }
}

async function handleOp(op, p = {}) {
  switch (op) {
    case 'STATUS': return status()
    case 'TAILOR': return tailor(p, p)
    case 'COVER_LETTER': return coverLetter(p, p)
    case 'COLD_MESSAGE':
    case 'COLD_EMAIL': return coldText(op, p)
    case 'CHECK_DUPLICATE': return checkDuplicate(p.company, p.title)
    case 'LOG_APPLICATION': return appendLedger(p)
    case 'GET_LEDGER': return readLedger()
    case 'GET_PDF': {
      const bytes = await loadPdf(p.name)
      return bytes ? bytesToBase64(bytes) : null
    }
    case 'IMPORT_RESUME': return importResume(p)
    case 'PREVIEW_TEX': return preview(p)
    case 'TEST_KEY': return callOne(p.entry, 'Reply with the single word OK.')
    case 'DEFAULT_TEMPLATES': return loadDefaultTemplates()
  }
  throw new Error(`Unknown Hemline operation: ${op}`)
}

// Ports (not one-shot messages) carry requests so the caller's keep-alive pings
// stop Chrome from suspending the service worker during 20-40 s LLM calls.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'hemline') return
  port.onMessage.addListener(async (msg) => {
    if (!msg?.op) return
    try {
      const result = await handleOp(msg.op, msg.payload)
      port.postMessage({ id: msg.id, ok: true, result })
    } catch (err) {
      port.postMessage({ id: msg.id, ok: false, error: err.message, latexError: err.latexError ?? extractLatexError(err.log) ?? null })
    }
  })
})

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage()
})

// ─── Batch Apply Queue Manager ──────────────────────────────────────────────
// Drives the watchlist's "Apply to N" flow: opens each selected job's ATS tab
// one at a time, tells the content script to fill/submit, and relays per-job
// status back to the originating watchlist tab. Only one tab is processed at a
// time so the serialized tailor + cover-letter pipelines never race.
const sleep = ms => new Promise(r => setTimeout(r, ms))

const queueState = {
  jobs:      [],
  policy:    {},
  originTab: null,
  running:   false,
  paused:    false,
  stopped:   false,
}

function relayProgress(done = false) {
  if (queueState.originTab == null) return
  chrome.tabs.sendMessage(queueState.originTab, {
    type: 'QUEUE_PROGRESS',
    jobs: queueState.jobs.map(j => ({ id: j.id, title: j.title, company: j.company, status: j.status, error: j.error })),
    done,
  }).catch(() => {})
}

function waitForTabComplete(tabId, timeout = 30_000) {
  return new Promise(resolve => {
    let settled = false
    const finish = ok => { if (settled) return; settled = true; chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); resolve(ok) }
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') finish(true) }
    chrome.tabs.onUpdated.addListener(onUpdated)
    const timer = setTimeout(() => finish(false), timeout)
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') finish(true) }).catch(() => finish(false))
  })
}

// The content script mounts at document_idle, so the first sendMessage often
// races the load. Retry until it answers or we give up.
async function sendRunApply(tabId, job, policy, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'RUN_APPLY', job, policy })
      if (res) return res
    } catch { /* content script not ready yet */ }
    await sleep(1500)
  }
  return { status: 'failed', error: 'content script never responded' }
}

async function logResult(job) {
  await appendLedger({ company: job.company, title: job.title, status: job.status, applyUrl: job.applyUrl })
    .catch(err => console.warn('[Hemline] ledger write failed:', err.message))
}

async function processQueue() {
  if (queueState.running) return
  queueState.running = true
  for (const job of queueState.jobs) {
    if (queueState.stopped) break
    while (queueState.paused && !queueState.stopped) await sleep(500)
    if (queueState.stopped) break

    job.status = 'opening'
    relayProgress()
    let tab
    try {
      tab = await chrome.tabs.create({ url: job.applyUrl, active: false })
      const loaded = await waitForTabComplete(tab.id)
      if (!loaded) throw new Error('apply page did not load')
      const result = await sendRunApply(tab.id, job, queueState.policy)
      job.status = result.status
      job.error = result.error
    } catch (err) {
      job.status = 'failed'
      job.error = err.message
    }
    relayProgress()
    if (job.status !== 'needs_review') logResult(job)
    // Submitted/failed tabs are disposable; needs_review tabs stay open for the
    // user to finish the screening questions manually.
    if (tab && job.status !== 'needs_review') {
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 2500)
    }
    await sleep(1500)
  }
  queueState.running = false
  relayProgress(true)
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_APPLY_QUEUE':
      queueState.jobs = message.jobs.map(j => ({ ...j, status: 'queued' }))
      queueState.policy = message.policy ?? {}
      queueState.originTab = sender.tab?.id ?? null
      queueState.paused = false
      queueState.stopped = false
      processQueue()
      sendResponse({ ok: true, count: queueState.jobs.length })
      return true
    case 'PAUSE_QUEUE':
      queueState.paused = true
      sendResponse({ ok: true })
      return true
    case 'RESUME_QUEUE':
      queueState.paused = false
      sendResponse({ ok: true })
      return true
    case 'STOP_QUEUE':
      queueState.stopped = true
      for (const j of queueState.jobs) if (j.status === 'queued') j.status = 'stopped'
      relayProgress(true)
      sendResponse({ ok: true })
      return true
    case 'APPLY_PROGRESS': {
      // Intermediate sub-status (tailoring / filling) from the ATS tab.
      const job = queueState.jobs.find(j => j.id === message.jobId)
      if (job) { job.status = message.status; relayProgress() }
      sendResponse({ ok: true })
      return true
    }
    default:
      return undefined
  }
})

// ─── Universal scraper (optional all-sites permission) ──────────────────────
// Mapped job boards get the content script from the manifest. Running on every
// other careers page needs the broad '*://*/*' grant, which the user opts into
// from the options page; we register the script only once it's granted.
const UNIVERSAL_ID = 'hemline-universal'

async function syncUniversalScript() {
  const granted = await chrome.permissions.contains({ origins: ['*://*/*'] })
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [UNIVERSAL_ID] })
  if (granted && existing.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: UNIVERSAL_ID,
      matches: ['*://*/*'],
      excludeMatches: chrome.runtime.getManifest().content_scripts.flatMap(cs => cs.matches),
      js: ['site_configs.js', 'content_script.js'],
      css: ['content.css'],
      runAt: 'document_idle',
    }])
  } else if (!granted && existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [UNIVERSAL_ID] })
  }
}

chrome.permissions.onAdded.addListener(() => syncUniversalScript().catch(err => console.warn('[Hemline]', err.message)))
chrome.permissions.onRemoved.addListener(() => syncUniversalScript().catch(err => console.warn('[Hemline]', err.message)))
chrome.runtime.onStartup.addListener(() => syncUniversalScript().catch(() => {}))
chrome.runtime.onInstalled.addListener(() => syncUniversalScript().catch(() => {}))

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })
})
