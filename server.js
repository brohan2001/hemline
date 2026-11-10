import express from 'express'
import cors from 'cors'
import { execSync, execFile, spawn } from 'child_process'
import net from 'net'
import { homedir } from 'os'
import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { promisify } from 'util'
import { sanitizeFilename } from './pipeline/latex.js'
import { computeMatchScore } from './pipeline/score.js'
import { tailorResume, writeCoverLetter, writeColdMessage, writeColdEmail } from './pipeline/tailor.js'
import { initStream, refresh, queryJobs, getJob, streamMeta } from './jobstream.js'

// BasicTeX installs pdflatex to /Library/TeX/texbin which is not in Node's
// inherited PATH on macOS when launched outside a login shell.
if (process.platform === 'darwin' && !process.env.PATH?.includes('/Library/TeX/texbin')) {
  process.env.PATH = `/Library/TeX/texbin:${process.env.PATH}`
}

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4567
const RESUMES_DIR = path.join(__dirname, 'resumes')
const BUILD_DIR = path.join(RESUMES_DIR, 'build')
const LEDGER_PATH = path.join(RESUMES_DIR, 'applied_jobs.json')

let claudePath = 'claude'
let pdflatexPath = null
if (process.env.NODE_ENV !== 'test') {
  try {
    claudePath = execSync('which claude').toString().trim()
  } catch {
    console.error('Warning: claude CLI not found on PATH. /tailor endpoint will fail.')
    claudePath = 'claude'
  }
  try {
    pdflatexPath = execSync('which pdflatex').toString().trim()
  } catch {
    console.error('Warning: pdflatex not found on PATH. PDF compilation will fail.')
  }
}

async function cleanupPdflatex(basePath) {
  for (const ext of ['.aux', '.log', '.out']) {
    await fs.unlink(basePath + ext).catch(() => {})
  }
}

// Serializes the tailor/cover-letter pipelines: both compile via pdflatex in
// shared directories, so concurrent requests would interleave file writes.
let pipelineLock = Promise.resolve()
function withPipelineLock(fn) {
  const run = pipelineLock.then(fn, fn)
  pipelineLock = run.then(() => {}, () => {})
  return run
}

const LOGS_DIR = path.join(__dirname, 'logs')
const PIPELINE_LOG = path.join(LOGS_DIR, 'pipeline.log')
const RELAY_LOG = path.join(LOGS_DIR, 'relay.log')

async function logPipeline(data) {
  await fs.mkdir(LOGS_DIR, { recursive: true })
  await fs.appendFile(PIPELINE_LOG, JSON.stringify({ ts: new Date().toISOString(), ...data }) + '\n', 'utf8')
}

async function readSkillFiles() {
  const files = await fs.readdir(RESUMES_DIR)
  const entries = await Promise.all(
    files
      .filter(f => f.startsWith('skills_') && f.endsWith('.txt'))
      .map(async f => [f, await fs.readFile(path.join(RESUMES_DIR, f), 'utf8')])
  )
  return Object.fromEntries(entries)
}

async function readProjectPool() {
  try {
    return await fs.readFile(path.join(RESUMES_DIR, 'project_pool.tex'), 'utf8')
  } catch {
    return null
  }
}

async function readLedger() {
  try {
    const parsed = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function appendLedger(entry) {
  const entries = await readLedger()
  entries.push(entry)
  await fs.writeFile(LEDGER_PATH, JSON.stringify(entries, null, 2), 'utf8')
}

// stdin is closed immediately to prevent a 3 s wait for piped input.
function runClaude(bin, prompt, cwd) {
  const modelArgs = process.env.CLAUDE_MODEL ? ['--model', process.env.CLAUDE_MODEL] : []
  return new Promise((resolve, reject) => {
    const child = execFile(bin, ['-p', prompt, '--dangerously-skip-permissions', ...modelArgs], {
      cwd,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
      } else {
        resolve({ stdout, stderr })
      }
    })
    child.stdin.end()
  })
}

async function callRelay(prompt, primaryModel) {
  const url = process.env.RELAY_URL || 'http://localhost:8000/v1/chat/completions'
  const model = primaryModel || process.env.RELAY_MODEL || 'google/gemini-3.5-flash'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 16384,
      }),
    })
    const data = await res.json()
    if (!data.choices?.[0]?.message?.content) {
      throw new Error(`no choices[0]: ${JSON.stringify(data).slice(0, 200)}`)
    }
    console.log(`[Relay] ${model} -> Success`)
    logPipeline({ event: 'relay_success', model, promptLen: prompt.length, choices: data.choices }).catch(() => {})
    return { stdout: data.choices[0].message.content, stderr: '' }
  } catch (err) {
    console.log(`[Relay] ${model} -> Failed (${err.message})`)
    logPipeline({ event: 'relay_fail', model, error: err.message, stack: err.stack }).catch(() => {})
    throw err
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    socket.connect(port, '127.0.0.1')
  })
}

async function maybeSpawnRelay() {
  if (process.env.LLM_PROVIDER !== 'relay') return
  const relayDir = (process.env.RELAY_DIR || '/Users/rohanbalasubramanian/Documents/RelayFreeLLM')
    .replace(/^~/, homedir())
  const occupied = await checkPort(8000)
  if (occupied) {
    console.log('RelayFreeLLM is already running on port 8000. Connecting safely.')
    return
  }
  console.log(`Spawning RelayFreeLLM from ${relayDir} ...`)
  const relay = spawn('python3', ['-m', 'src.server'], { cwd: relayDir, stdio: ['ignore', 'pipe', 'pipe'] })
  relay.on('error', (err) => console.error('Failed to start RelayFreeLLM:', err.message))

  let pendingAttempt = null
  const flushPending = (outcome) => {
    if (!pendingAttempt) return
    console.log(`[Relay Attempt] Attempt ${pendingAttempt.n}/${pendingAttempt.total}: ${pendingAttempt.model} -> ${outcome}`)
    pendingAttempt = null
  }
  const handleRelayLine = (line) => {
    const startM = line.match(/Hierarchy attempt (\d+)\/(\d+):\s+(.+)/)
    const failM  = line.match(/Hierarchy attempt (\d+) failed \(([^)]+)\):\s*(.+)/)
    if (startM) {
      flushPending('Success')
      pendingAttempt = { n: startM[1], total: startM[2], model: startM[3].trim() }
    } else if (failM) {
      flushPending(`Failed (${failM[3].trim()})`)
    } else if (/HTTP\/1\.1"\s+200/.test(line)) {
      flushPending('Success')
    }
  }
  const buffers = { stdout: '', stderr: '' }
  const pipeRelayStream = (stream, name) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString()
      fs.appendFile(RELAY_LOG, text, 'utf8').catch(() => {})
      buffers[name] += text
      const lines = buffers[name].split('\n')
      buffers[name] = lines.pop()
      lines.forEach(handleRelayLine)
    })
  }
  pipeRelayStream(relay.stdout, 'stdout')
  pipeRelayStream(relay.stderr, 'stderr')
  relay.on('exit', () => flushPending('Success'))
}

const app = express()
app.use(cors({ exposedHeaders: ['X-JSeek-Match-Score'] }))
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/health', async (_req, res) => res.json({
  status: 'ok',
  claudePath,
  pdflatexFound: pdflatexPath !== null,
  provider: process.env.LLM_PROVIDER || 'claude',
  relayUp: await checkPort(8000),
}))

// Serves the last-compiled master resume so the extension can attach it to
// application forms. 404 until /tailor has produced swe.pdf at least once.
app.get('/api/resume', async (_req, res) => {
  try {
    const pdf = await fs.readFile(path.join(RESUMES_DIR, 'swe.pdf'))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="swe.pdf"')
    res.send(pdf)
  } catch {
    res.status(404).json({ error: 'Resume PDF not found. Run /tailor first.' })
  }
})

app.get('/api/cover-letter', async (_req, res) => {
  try {
    const pdf = await fs.readFile(path.join(RESUMES_DIR, 'cover_letter.pdf'))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="cover_letter.pdf"')
    res.send(pdf)
  } catch {
    res.status(404).json({ error: 'Cover letter PDF not found. Run /cover-letter first.' })
  }
})

app.get('/stats', async (_req, res) => {
  let raw = ''
  try { raw = await fs.readFile(PIPELINE_LOG, 'utf8') } catch { /* no log yet */ }

  const requests = {}
  const models = {}
  const byDay = {}
  for (const line of raw.split('\n')) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.event === 'request_complete') {
      const r = requests[ev.endpoint] ??= { count: 0, errors: 0, totalMs: 0, llmMs: 0, maxTotalMs: 0 }
      r.count++
      r.totalMs += ev.totalMs ?? 0
      r.llmMs += ev.llmMs ?? 0
      r.maxTotalMs = Math.max(r.maxTotalMs, ev.totalMs ?? 0)
      const day = (ev.ts ?? '').slice(0, 10)
      if (day) byDay[day] = (byDay[day] ?? 0) + 1
    } else if (ev.event === 'request_error') {
      const r = requests[ev.endpoint] ??= { count: 0, errors: 0, totalMs: 0, llmMs: 0, maxTotalMs: 0 }
      r.errors++
    } else if (ev.event === 'relay_success' && ev.model) {
      const m = models[ev.model] ??= { success: 0, fail: 0 }
      m.success++
    } else if (ev.event === 'relay_fail' && ev.model) {
      const m = models[ev.model] ??= { success: 0, fail: 0 }
      m.fail++
    }
  }
  for (const r of Object.values(requests)) {
    r.avgTotalMs = r.count ? Math.round(r.totalMs / r.count) : 0
    r.avgLlmMs = r.count ? Math.round(r.llmMs / r.count) : 0
    delete r.totalMs
    delete r.llmMs
  }
  res.json({ requests, models, byDay })
})

// Paginated, filtered slice of the in-memory job stream (USA tech, scored/sorted).
app.get('/api/jobs', (req, res) => {
  const { role, level, location, workMode, q } = req.query
  const result = queryJobs({
    role, level, location, workMode, q,
    h1bOnly: req.query.h1bOnly === '1' || req.query.h1bOnly === 'true',
    earlyOnly: req.query.earlyOnly === '1' || req.query.earlyOnly === 'true',
    offset: Math.max(0, parseInt(req.query.offset, 10) || 0),
    limit: Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100)),
  })
  res.json({ ...result, ...streamMeta() })
})

// Full single job (with description + score breakdown) for the detail panel.
app.get('/api/job/:id', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  res.json(job)
})

// Manual refresh trigger (dashboard "Refresh Now"). Runs in the background.
app.post('/api/refresh', (_req, res) => {
  refresh()
  res.json({ started: true, ...streamMeta() })
})

app.get('/applications', async (_req, res) => {
  const applications = await readLedger()
  res.json({ count: applications.length, applications })
})

app.post('/applications/log', async (req, res) => {
  const { company = '', title = '', status = 'submitted', applyUrl = '' } = req.body
  if (!company && !title) return res.status(400).json({ error: 'company or title is required' })
  await appendLedger({
    company,
    title,
    date:       new Date().toISOString().slice(0, 10),
    status,
    applyUrl,
    resumePath: null,
    clPath:     null,
  })
  res.json({ ok: true })
})

app.get('/applications/check', async (req, res) => {
  const company = (req.query.company ?? '').trim().toLowerCase()
  const title = (req.query.title ?? '').trim().toLowerCase()
  if (!company) return res.status(400).json({ error: 'company query param is required' })

  const cutoff = Date.now() - 30 * 864e5
  const matches = (await readLedger()).filter(e => {
    if ((e.company ?? '').trim().toLowerCase() !== company) return false
    if (title && (e.title ?? '').trim().toLowerCase() !== title) return false
    const ts = Date.parse(e.date)
    return !Number.isNaN(ts) && ts >= cutoff
  })
  if (matches.length === 0) return res.json({ duplicate: false })

  const latest = matches.reduce((a, b) => (a.date > b.date ? a : b))
  res.json({ duplicate: true, lastDate: latest.date, lastTitle: latest.title, timesApplied: matches.length })
})

const CANDIDATE = {
  name: process.env.CANDIDATE_NAME ?? '',
  highlights: process.env.CANDIDATE_HIGHLIGHTS ?? '',
}

function filePrefix() {
  return sanitizeFilename(CANDIDATE.name) === 'Company' ? 'Resume' : sanitizeFilename(CANDIDATE.name)
}

function llmFor(provider, relayModel) {
  return async (prompt) => provider === 'relay'
    ? (await callRelay(prompt, relayModel)).stdout
    : (await runClaude(claudePath, prompt, __dirname)).stdout
}

function resolveProvider(req) {
  return req.body.provider || process.env.LLM_PROVIDER || 'claude'
}

// Compiles inside a sandbox dir so the master templates are never mutated.
function pdflatexCompiler(dir, base) {
  const texPath = path.join(dir, `${base}.tex`)
  return async (tex) => {
    await fs.writeFile(texPath, tex, 'utf8')
    try {
      const { stdout } = await execFileAsync('pdflatex', ['-interaction=nonstopmode', `-output-directory=${dir}`, texPath], { cwd: __dirname, timeout: 60_000 })
      return { pdf: await fs.readFile(path.join(dir, `${base}.pdf`)), log: stdout }
    } catch (err) {
      console.error(`pdflatex FAILED (${base}). stdout:\n` + (err.stdout || '(empty)'))
      throw err
    }
  }
}

function pipelineLogger(extra) {
  return (data) => logPipeline({ ...extra, ...data }).catch(() => {})
}

app.post('/tailor', async (req, res) => {
  const { jobDescription, companyName = '', jobTitle = '' } = req.body
  if (!jobDescription || typeof jobDescription !== 'string' || jobDescription.trim().length === 0) {
    return res.status(400).json({ error: 'jobDescription is required' })
  }
  const safe = sanitizeFilename(companyName)
  const provider = resolveProvider(req)
  const log = pipelineLogger({ company: companyName, provider })

  try {
    await withPipelineLock(async () => {
      const t0 = performance.now()
      await fs.mkdir(BUILD_DIR, { recursive: true })
      const [sweTex, skills, projectPool] = await Promise.all([
        fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8'),
        readSkillFiles(),
        readProjectPool(),
      ])
      const { pdf, match } = await tailorResume({
        jd: jobDescription, sweTex, skills, projectPool, log,
        callLlm: llmFor(provider, process.env.RELAY_MODEL || 'google/gemini-3.5-flash'),
        compile: pdflatexCompiler(BUILD_DIR, 'swe'),
      })
      await fs.copyFile(path.join(BUILD_DIR, 'swe.pdf'), path.join(RESUMES_DIR, 'swe.pdf')).catch(() => {})
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filePrefix()}_Resume_${safe}.pdf"`)
      res.setHeader('X-JSeek-Match-Score', String(match.score))
      res.send(pdf)

      const totalMs = Math.round(performance.now() - t0)
      console.log(`[/tailor] Done in ${(totalMs / 1000).toFixed(1)}s | match ${match.score}% | provider: ${provider}`)
      log({ event: 'request_complete', endpoint: '/tailor', totalMs })
      cleanupPdflatex(path.join(BUILD_DIR, 'swe')).catch(() => {})
      appendLedger({
        company: companyName, title: jobTitle, date: new Date().toISOString().slice(0, 10),
        resumePath: `resumes/${filePrefix()}_Resume_${safe}.pdf`, clPath: null,
      }).catch(err => console.error('appendLedger /tailor error:', err.message))
    })
  } catch (err) {
    console.error('/tailor error:', err.message)
    log({ event: 'request_error', endpoint: '/tailor', error: err.message })
    res.status(500).json({ error: err.message, latexError: err.latexError ?? null })
  }
})

app.post('/cover-letter', async (req, res) => {
  const { jd, companyName = '', jobTitle = '' } = req.body
  if (!jd || typeof jd !== 'string' || jd.trim().length === 0) {
    return res.status(400).json({ error: 'jd is required' })
  }
  const safe = sanitizeFilename(companyName)
  const base = `${filePrefix()}_CL_${safe}`
  const provider = resolveProvider(req)
  const log = pipelineLogger({ company: companyName, provider })

  try {
    await withPipelineLock(async () => {
      const t0 = performance.now()
      const [sweTex, clTemplate, skills] = await Promise.all([
        fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8'),
        fs.readFile(path.join(RESUMES_DIR, 'cover_letter_template.tex'), 'utf8'),
        readSkillFiles(),
      ])
      const { pdf } = await writeCoverLetter({
        jd, jobTitle, companyName, sweTex, clTemplate, skills, candidate: CANDIDATE, log,
        callLlm: llmFor(provider, process.env.RELAY_CL_MODEL || 'cerebras/zai-glm-4.7'),
        compile: pdflatexCompiler(RESUMES_DIR, base),
      })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`)
      res.send(pdf)

      const totalMs = Math.round(performance.now() - t0)
      console.log(`[/cover-letter] Done in ${(totalMs / 1000).toFixed(1)}s | provider: ${provider}`)
      log({ event: 'request_complete', endpoint: '/cover-letter', totalMs })
      // Keep the last cover letter at a stable path so /api/cover-letter can serve
      // it for batch-apply uploads (the per-company files are deleted right below).
      await fs.copyFile(path.join(RESUMES_DIR, `${base}.pdf`), path.join(RESUMES_DIR, 'cover_letter.pdf')).catch(() => {})
      fs.unlink(path.join(RESUMES_DIR, `${base}.tex`)).catch(() => {})
      fs.unlink(path.join(RESUMES_DIR, `${base}.pdf`)).catch(() => {})
      cleanupPdflatex(path.join(RESUMES_DIR, base)).catch(() => {})
      appendLedger({
        company: companyName, title: jobTitle, date: new Date().toISOString().slice(0, 10),
        resumePath: null, clPath: `resumes/${base}.pdf`,
      }).catch(err => console.error('appendLedger /cover-letter error:', err.message))
    })
  } catch (err) {
    console.error('/cover-letter error:', err.message)
    log({ event: 'request_error', endpoint: '/cover-letter', error: err.message })
    res.status(500).json({ error: err.message, latexError: err.latexError ?? null })
  }
})

app.post('/cold-message', async (req, res) => {
  const { jd, companyName = '', jobTitle = '' } = req.body
  if (!jd || typeof jd !== 'string' || jd.trim().length === 0) {
    return res.status(400).json({ error: 'jd is required' })
  }
  try {
    const sweTex = await fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8')
    const message = await writeColdMessage({
      jd, companyName, jobTitle, sweTex, candidate: CANDIDATE,
      callLlm: llmFor(resolveProvider(req), process.env.RELAY_MODEL || 'google/gemini-3.5-flash'),
    })
    res.json({ message })
  } catch (err) {
    console.error('/cold-message error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/cold-email', async (req, res) => {
  const { jd, companyName = '', jobTitle = '' } = req.body
  if (!jd || typeof jd !== 'string' || jd.trim().length === 0) {
    return res.status(400).json({ error: 'jd is required' })
  }
  const provider = resolveProvider(req)
  try {
    const sweTex = await fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8')
    const email = await writeColdEmail({
      jd, companyName, jobTitle, sweTex, candidate: CANDIDATE,
      log: pipelineLogger({ company: companyName, provider }),
      callLlm: llmFor(provider, process.env.RELAY_MODEL || 'google/gemini-3.5-flash'),
    })
    res.json(email)
  } catch (err) {
    console.error('/cold-email error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { app, appendLedger, computeMatchScore }

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  ;(async () => {
    await maybeSpawnRelay()
    initStream()
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`JSeek Enhancer server running on http://127.0.0.1:${PORT}`)
      console.log(`Claude CLI: ${claudePath}`)
    })
  })()
}
