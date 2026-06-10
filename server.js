import express from 'express'
import cors from 'cors'
import { execSync, execFile, spawn } from 'child_process'
import net from 'net'
import { homedir } from 'os'
import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { promisify } from 'util'
import { sanitizeLatex } from './scripts/verify-latex.js'

// BasicTeX installs pdflatex to /Library/TeX/texbin which is not in Node's
// inherited PATH on macOS when launched outside a login shell.
if (process.platform === 'darwin' && !process.env.PATH?.includes('/Library/TeX/texbin')) {
  process.env.PATH = `/Library/TeX/texbin:${process.env.PATH}`
}

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4567
const RESUMES_DIR = path.join(__dirname, 'resumes')
const LEDGER_PATH = path.join(RESUMES_DIR, 'applied_jobs.json')

let claudePath = 'claude'
if (process.env.NODE_ENV !== 'test') {
  try {
    claudePath = execSync('which claude').toString().trim()
  } catch {
    console.error('Warning: claude CLI not found on PATH. /tailor endpoint will fail.')
    claudePath = 'claude'
  }
}

function buildResumePrompt(jobDescription, sweTex, skills, projectPool) {
  const skillsBlock = Object.entries(skills)
    .map(([name, content]) => `<${name}>\n${content}\n</${name}>`)
    .join('\n\n')

  const projectInstructions = projectPool
    ? `
Here is the project pool (8 projects):
<project_pool>
${projectPool}
</project_pool>

Also update ONLY the Projects section with these strict constraints:
- Analyze the job description and select the 3 projects from the project pool that best match its requirements.
- Replace the contents of \\section{Projects} with exactly those 3 projects, copied VERBATIM from the pool — do not rewrite, shorten, or merge any bullet.
- Keep the \\resumeSubHeadingListStart / \\resumeSubHeadingListEnd wrapper around the 3 projects exactly as in the current document.
`
    : ''

  return `You are editing a LaTeX resume. Your output must be the complete, valid LaTeX source — nothing else.

Here is the current resumes/swe.tex:
<swe_tex>
${sweTex}
</swe_tex>

Here are the skill pools:
${skillsBlock}
${projectInstructions}
The target job description is:
<job_description>
${jobDescription.trim()}
</job_description>

Update ONLY the Technical Skills section with these strict constraints:
- Exactly 5 skill headings total.
- Row 1 heading must be "Languages".
- Rows 2, 3, and 4: choose headings that best match the job description (e.g., "Frameworks", "Developer Tools", "Libraries", "Cloud \\& DevOps").
- Row 5 heading must be "Courses". All course names must fit on a single physical line — do NOT insert a \\\\ line break within the Courses row. The total visible characters of the Courses line must be strictly between 150 and 200.
- Pull skills from the skill pools that match keywords in the job description.
- Add any critical missing skills explicitly required by the job description (e.g., Docker, Kubernetes) if not already present.
- Every physical line of skills content (ignoring LaTeX markup like \\textbf{}, \\item, \\\\) must produce strictly between 60 and 105 characters of visible PDF text. If a line is too short, pack it with more relevant, matching keywords from the skill pools to maximize ATS keyword density, but do not exceed 105 characters.
- CRITICAL: In LaTeX, the ampersand character & is a reserved alignment tab. Always write it as \\& inside \\textbf{} headings and skill content (e.g., \\textbf{Cloud \\& DevOps}, never \\textbf{Cloud & DevOps}).
- Do not modify any section other than Technical Skills${projectPool ? ' and Projects' : ''}.

Output the complete modified swe.tex to stdout. Output ONLY the raw LaTeX — no explanation, no markdown fences, no commentary.`
}

function buildClPrompt(jd, jobTitle, companyName, sweTex, clTemplate, skills) {
  const skillsBlock = Object.entries(skills)
    .map(([name, content]) => `<${name}>\n${content}\n</${name}>`)
    .join('\n\n')

  return `You are a technical career advisor writing a highly personalized cover letter. Your output must be a complete, valid LaTeX document — nothing else.

Here is Rohan's resume (resumes/swe.tex):
<swe_tex>
${sweTex}
</swe_tex>

Here is the cover letter template (resumes/cover_letter_template.tex):
<cover_letter_template>
${clTemplate}
</cover_letter_template>

Here are the skill pools:
${skillsBlock}

The target job description is:
<job_description>
${jd.trim()}
</job_description>

Write a 3-paragraph cover letter body for Rohan Balasubramanian applying to the role of "${jobTitle}" at "${companyName}".

Paragraph rules:
- Paragraph 1: Open with a specific hook directly connecting Rohan's MS CS at Stony Brook and his GRA work (SadTalker lip-sync, NeMo TTS pipelines, CUDA/GPU optimization) to a concrete technical requirement stated in the job description. Be specific; name the requirement.
- Paragraph 2: Highlight 1-2 projects from swe.tex that are most relevant to this JD (e.g., Predicare's Django + Kubernetes auto-scaling, Constrained Text Generation with Llama, Auto Vision with Flutter/TensorFlow). Cite any measurable outcomes that appear in swe.tex (percentages, latency numbers, scale figures).
- Paragraph 3: One short forward-looking paragraph on what Rohan will bring to the team. Close with one specific sentence expressing genuine enthusiasm for this role at ${companyName}; avoid generic phrasing.

STRICT PROSE STYLE AND ANTI-AI CONSTRAINTS (DO NOT VIOLATE):
1. Tone: Write in the register of a senior professor. Be dry, authoritative, empirical, and understated. Do not use flowery adjectives such as passionate or eager.
2. No negation framing: Do not use constructions like "Not only X, but also Y", "It is not just X, it is Y", or "This is X, not Y". State what Rohan did directly; do not define him by contrast or negation.
3. No evaluative labeling: Do not end paragraphs with summary sentences that tag or evaluate the evidence (e.g., BANNED: "This reflects research maturity", "This is hypothesis-driven debugging", "This demonstrates leadership"). Trust the reader to draw conclusions from the evidence itself.
4. Indirect speech only: Never use direct quotation marks to quote dialogue or internal thoughts. Use indirect speech exclusively.
5. Banned words: Never use any of the following words or their derivatives: delve, foster, underscore, landscape, tapestry, testament, pivotal, invaluable, unwavering, commendable, meticulous, seamlessly, intersection, realm, prowess.
6. No em dashes: Do not use em dashes anywhere in the output. Use semicolons, commas, or periods instead.
7. Sentence rhythm: Avoid staccato chains of short Subject-Verb-Object sentences. Connect complex thoughts fluidly using subordinating conjunctions such as although, while, because, given that, and whereas.

LaTeX formatting rules (strictly follow these):
- Replace [Paragraph 1], [Paragraph 2], and [Paragraph 3] in the template with the three paragraphs above.
- Escape ALL special characters: & becomes \\&, % becomes \\%, $ becomes \\$, # becomes \\#, _ becomes \\_
- Do NOT use any of these banned phrases: "I am excited to apply", "I believe my skills", "I am writing to express", "I am passionate about", "leverage my experience".
- Preserve all other template content (heading, contact line, margins, "Dear Hiring Manager", sign-off) exactly as written in the template.

Output the complete final LaTeX document to stdout. Output ONLY the raw LaTeX — no explanation, no markdown fences, no commentary.`
}

function buildColdMessagePrompt(jd, companyName, jobTitle, sweTex) {
  return `You are writing a LinkedIn connection request message for Rohan Balasubramanian.
Output ONLY the message text — no explanation, no quotes, no preamble, no markdown.

Here is Rohan's resume for context:
<swe_tex>
${sweTex}
</swe_tex>

Target role: "${jobTitle}" at "${companyName}".
Job description:
<job_description>
${jd.trim()}
</job_description>

Write exactly 4 sentences. Count the total characters carefully — the combined character count of all 4 sentences must be strictly under 300 characters.

Connect one specific technical theme from Rohan's GRA work (SadTalker lip-sync, NeMo TTS pipelines, CUDA/GPU optimization) or his projects (Predicare, Constrained Text Generation, Auto Vision) directly to a concrete challenge stated in the job description.

STRICT ANTI-AI STYLE RULES (DO NOT VIOLATE):
1. Senior professor register — dry, authoritative, empirical. No flowery adjectives.
2. No negation framing. State what Rohan did; do not define by contrast.
3. No evaluative labeling. Trust the reader to draw conclusions.
4. Indirect speech only. No direct quotation marks.
5. Banned words: delve, foster, underscore, landscape, tapestry, testament, pivotal, invaluable, unwavering, commendable, meticulous, seamlessly, intersection, realm, prowess.
6. No em dashes.
7. Do not start with "I".

Output ONLY the message. Nothing else.`
}

function buildColdEmailPrompt(jd, companyName, jobTitle, sweTex) {
  return `You are writing a cold recruiter email for Rohan Balasubramanian.
Output the email as plain text: first line must be "Subject: <subject under 80 chars>", then a blank line, then the email body. Nothing else — no explanation, no markdown.

Here is Rohan's resume for context:
<swe_tex>
${sweTex}
</swe_tex>

Target role: "${jobTitle}" at "${companyName}".
Job description:
<job_description>
${jd.trim()}
</job_description>

Write a 3-paragraph email body:
- Paragraph 1: Open with a specific hook connecting Rohan's MS CS at Stony Brook and his GRA work (SadTalker lip-sync, NeMo TTS pipelines, CUDA/GPU optimization) to a concrete requirement in the job description.
- Paragraph 2: Highlight 1-2 of the most relevant projects from the resume, citing measurable outcomes that appear in it.
- Paragraph 3: One short closing paragraph requesting a brief conversation about the role. Sign off with "Best regards,\nRohan Balasubramanian".

STRICT ANTI-AI STYLE RULES (DO NOT VIOLATE):
1. Senior professor register — dry, authoritative, empirical. No flowery adjectives.
2. No negation framing. State what Rohan did; do not define by contrast.
3. No evaluative labeling. Trust the reader to draw conclusions.
4. Indirect speech only. No direct quotation marks.
5. Banned words: delve, foster, underscore, landscape, tapestry, testament, pivotal, invaluable, unwavering, commendable, meticulous, seamlessly, intersection, realm, prowess.
6. No em dashes.

Output ONLY the subject line and email. Nothing else.`
}

function extractSkillsSection(tex) {
  const lines = tex.split('\n')
  const start = lines.findIndex(l => l.includes('Technical Skills'))
  if (start === -1) return '  (Technical Skills section not found in file)'
  const end = lines.findIndex((l, i) => i > start && l.trimStart().startsWith('\\section{'))
  return lines.slice(start, end === -1 ? start + 40 : end).join('\n')
}

// Strips any preamble text Claude may emit before \documentclass and after \end{document}.
function extractLatex(output) {
  const start = output.indexOf('\\documentclass')
  const end = output.lastIndexOf('\\end{document}')
  if (start === -1 || end === -1) return null
  return output.slice(start, end + '\\end{document}'.length)
}

// Escapes any bare & in the Technical Skills section body that the LLM forgot to escape.
function sanitizeSkillsAmpersands(tex) {
  const start = tex.indexOf('\\section{Technical Skills}')
  if (start === -1) return tex
  const end = tex.indexOf('\\section{', start + 1)
  const boundary = end === -1 ? tex.length : end
  const skillsChunk = tex.slice(start, boundary).replace(/(?<!\\)&/g, '\\&')
  return tex.slice(0, start) + skillsChunk + tex.slice(boundary)
}

// Used by /cover-letter: grafts the template preamble onto the LLM-generated body.
function graftPreamble(original, llmOutput) {
  const MARKER = '\\begin{document}'
  const origIdx = original.indexOf(MARKER)
  const llmIdx = llmOutput.indexOf(MARKER)
  if (origIdx === -1 || llmIdx === -1) return llmOutput
  return original.slice(0, origIdx + MARKER.length) + llmOutput.slice(llmIdx + MARKER.length)
}

// Used by /tailor: surgically replaces only the named \section{...} block from
// llmOutput into the original document, leaving everything else untouched so the
// LLM can never corrupt \resumeItemListEnd or other custom commands in the body.
function graftSection(original, llmOutput, sectionName) {
  const TAG = `\\section{${sectionName}}`
  const llmStart = llmOutput.indexOf(TAG)
  if (llmStart === -1) return original
  const llmNext = llmOutput.indexOf('\\section{', llmStart + 1)
  const llmBlock = llmOutput.slice(llmStart, llmNext === -1 ? llmOutput.length : llmNext)

  const origStart = original.indexOf(TAG)
  if (origStart === -1) return original
  const origNext = original.indexOf('\\section{', origStart + 1)
  const origEnd = origNext === -1 ? original.length : origNext

  return original.slice(0, origStart) + llmBlock + original.slice(origEnd)
}

const graftSkillsSection   = (original, llmOutput) => graftSection(original, llmOutput, 'Technical Skills')
const graftProjectsSection = (original, llmOutput) => graftSection(original, llmOutput, 'Projects')

// Reads the page count pdflatex reports, e.g. "Output written on swe.pdf (1 page, ...)".
function parsePageCount(stdout) {
  const m = (stdout ?? '').match(/Output written on .*? \((\d+) page/)
  return m ? parseInt(m[1], 10) : null
}

// Tightens vertical spacing so an overflowing resume collapses back to 1 page:
// pulls the top margin up 0.05in and extends the text height 0.1in per pass.
function tightenVerticalSpacing(tex) {
  return tex
    .replace(/\\addtolength\{\\topmargin\}\{(-?[\d.]+)in\}/, (_, v) =>
      `\\addtolength{\\topmargin}{${(parseFloat(v) - 0.05).toFixed(2)}in}`)
    .replace(/\\addtolength\{\\textheight\}\{(-?[\d.]+)in\}/, (_, v) =>
      `\\addtolength{\\textheight}{${(parseFloat(v) + 0.1).toFixed(2)}in}`)
}

function sanitizeFilename(name) {
  return (name ?? '').replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Company'
}

async function cleanupPdflatex(basePath) {
  for (const ext of ['.aux', '.log', '.out']) {
    await fs.unlink(basePath + ext).catch(() => {})
  }
}

const LOGS_DIR = path.join(__dirname, 'logs')
const PIPELINE_LOG = path.join(LOGS_DIR, 'pipeline.log')
const RELAY_LOG = path.join(LOGS_DIR, 'relay.log')

async function logPipeline(data) {
  await fs.mkdir(LOGS_DIR, { recursive: true })
  await fs.appendFile(PIPELINE_LOG, JSON.stringify({ ts: new Date().toISOString(), ...data }) + '\n', 'utf8')
}

// Trims text to maxLen chars without cutting a word mid-token.
function trimToWord(text, maxLen) {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(' ', maxLen)
  return cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)
}

function trimToItem(text, maxLen) {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(',', maxLen)
  return cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)
}

// Estimates the visible PDF character count of a LaTeX skills line.
function visibleLength(latexLine) {
  return latexLine
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\item\s*/g, '')
    .replace(/\\\\$/, '')
    .replace(/\\&/g, '&')
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .length
}

// Clamps skill rows 2–4 to ≤105 visible chars to prevent PDF margin overflow.
function applySkillsLineTrimmer(tex, maxVisible = 105) {
  const start = tex.indexOf('\\section{Technical Skills}')
  if (start === -1) return tex
  const end = tex.indexOf('\\section{', start + 1)
  const boundary = end === -1 ? tex.length : end
  const lines = tex.slice(start, boundary).split('\n')
  let contentRow = 0
  const trimmed = lines.map(line => {
    if (!line.includes('\\textbf{')) return line
    contentRow++
    if (contentRow < 2) return line
    const limit = contentRow <= 4 ? maxVisible : 200
    if (visibleLength(line) <= limit) return line
    const originalLine = line
    const m = line.match(/^(.*?\\textbf\{[^}]+\}\{)(.*?)(\}\s*(?:\\\\)?)\s*$/)
    let result
    if (!m) {
      result = trimToItem(line, line.length - (visibleLength(line) - limit))
    } else {
      const trimmedBody = trimToItem(m[2], limit - visibleLength(m[1])).replace(/,\s*$/, '')
      result = m[1] + trimmedBody + m[3]
    }
    console.log(`[Trimmer] Line Trimmed! Original: "${originalLine}" -> Trimmed: "${result}"`)
    return result
  })
  return tex.slice(0, start) + trimmed.join('\n') + tex.slice(boundary)
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

async function appendLedger(entry) {
  let entries = []
  try {
    const raw = await fs.readFile(LEDGER_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) entries = parsed
  } catch { /* file missing or malformed — start fresh */ }
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
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/health', (_req, res) => res.json({ status: 'ok', claudePath }))

app.post('/tailor', async (req, res) => {
  const { jobDescription, companyName = '', jobTitle = '' } = req.body
  if (!jobDescription || typeof jobDescription !== 'string' || jobDescription.trim().length === 0) {
    return res.status(400).json({ error: 'jobDescription is required' })
  }

  const safe = sanitizeFilename(companyName)
  const texFile = path.join(RESUMES_DIR, 'swe.tex')
  const pdfFile = path.join(RESUMES_DIR, 'swe.pdf')

  try {
    const t0 = performance.now()
    console.log(`[/tailor] Company: ${companyName || '(none)'} | JD: ${jobDescription.length} chars`)

    const [sweTex, skills, projectPool] = await Promise.all([
      fs.readFile(texFile, 'utf8'),
      readSkillFiles(),
      readProjectPool(),
    ])

    const provider = req.body.provider || process.env.LLM_PROVIDER || 'claude'
    const resumePrompt = buildResumePrompt(jobDescription, sweTex, skills, projectPool)
    logPipeline({ event: 'tailor_request', company: companyName, provider, promptLen: resumePrompt.length, prompt: resumePrompt }).catch(() => {})

    const t1 = performance.now()
    let claudeResult
    try {
      claudeResult = provider === 'relay'
        ? await callRelay(resumePrompt, process.env.RELAY_MODEL || 'google/gemini-3.5-flash')
        : await runClaude(claudePath, resumePrompt, __dirname)
    } catch (claudeErr) {
      logPipeline({ event: 'tailor_llm_error', error: claudeErr.message }).catch(() => {})
      throw claudeErr
    }
    const t2 = performance.now()

    const rawTex = extractLatex(claudeResult.stdout)
    if (!rawTex) throw new Error(`LLM output did not contain valid LaTeX (stdout preview: ${claudeResult.stdout.slice(0, 300)})`)
    const grafted = graftProjectsSection(graftSkillsSection(sweTex, rawTex), rawTex)
    const { tex: sanitizedTex, fixes } = sanitizeLatex(applySkillsLineTrimmer(sanitizeSkillsAmpersands(grafted)))
    if (fixes > 0) console.log(`[Sanitizer] Escaped ${fixes} bare special characters before compile`)
    let newTex = sanitizedTex
    logPipeline({ event: 'tailor_llm_output', company: companyName, outputLen: newTex.length, rawOutput: claudeResult.stdout }).catch(() => {})

    const skillsStart = newTex.indexOf('\\section{Technical Skills}')
    const skillsEnd   = newTex.indexOf('\\section{', skillsStart + 1)
    const skillsBlock = skillsStart !== -1
      ? newTex.slice(skillsStart, skillsEnd === -1 ? undefined : skillsEnd).trim()
      : '(not found)'
    logPipeline({ event: 'tailor_skills_block', company: companyName, skillsBlock }).catch(() => {})
    console.log(`[Stage 4] LLM generated Technical Skills only (${skillsBlock.split('\n').length} lines). Compiling PDF…`)

    await fs.writeFile(texFile, newTex, 'utf8')

    const pdflatexArgs = ['-interaction=nonstopmode', `-output-directory=${RESUMES_DIR}`, texFile]
    let latexResult
    try {
      latexResult = await execFileAsync('pdflatex', pdflatexArgs, { cwd: __dirname, timeout: 60_000 })
    } catch (pdfErr) {
      await fs.writeFile(texFile, sweTex, 'utf8').catch(() => {})
      console.error('pdflatex FAILED (tailor). stdout:\n' + (pdfErr.stdout || '(empty)'))
      console.error('pdflatex stderr:\n' + (pdfErr.stderr || '(empty)'))
      throw pdfErr
    }

    let pageCount = parsePageCount(latexResult.stdout)
    for (let attempt = 1; pageCount > 1 && attempt <= 5; attempt++) {
      console.log(`[PageGuard] Page count: ${pageCount}, attempt ${attempt}/5 — tightening vertical spacing`)
      newTex = tightenVerticalSpacing(newTex)
      await fs.writeFile(texFile, newTex, 'utf8')
      try {
        latexResult = await execFileAsync('pdflatex', pdflatexArgs, { cwd: __dirname, timeout: 60_000 })
      } catch (pdfErr) {
        await fs.writeFile(texFile, sweTex, 'utf8').catch(() => {})
        console.error('pdflatex FAILED (page guard). stdout:\n' + (pdfErr.stdout || '(empty)'))
        throw pdfErr
      }
      pageCount = parsePageCount(latexResult.stdout)
    }
    if (pageCount > 1) console.warn(`[PageGuard] Still ${pageCount} pages after 5 attempts; shipping as-is`)
    const t3 = performance.now()

    const pdfBuffer = await fs.readFile(pdfFile)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="Rohan_Resume_${safe}.pdf"`)
    res.send(pdfBuffer)
    const t4 = performance.now()

    console.log(`[/tailor] Done: LLM ${((t2 - t1) / 1000).toFixed(1)}s | pdflatex ${((t3 - t2) / 1000).toFixed(1)}s | total ${((t4 - t0) / 1000).toFixed(1)}s | provider: ${provider}`)

    cleanupPdflatex(path.join(RESUMES_DIR, 'swe')).catch(() => {})
    appendLedger({
      company:    companyName,
      title:      jobTitle,
      date:       new Date().toISOString().slice(0, 10),
      resumePath: `resumes/Rohan_Resume_${safe}.pdf`,
      clPath:     null,
    }).catch(err => console.error('appendLedger /tailor error:', err.message))
  } catch (err) {
    console.error('/tailor error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/cover-letter', async (req, res) => {
  const { jd, companyName = '', jobTitle = '' } = req.body
  if (!jd || typeof jd !== 'string' || jd.trim().length === 0) {
    return res.status(400).json({ error: 'jd is required' })
  }

  const safe = sanitizeFilename(companyName)
  const outTex = path.join(RESUMES_DIR, `Rohan_CL_${safe}.tex`)
  const outPdf = path.join(RESUMES_DIR, `Rohan_CL_${safe}.pdf`)

  try {
    const t0 = performance.now()
    console.log(`[/cover-letter] Company: ${companyName || '(none)'} | JD: ${jd.length} chars`)

    const [sweTex, clTemplate, skills] = await Promise.all([
      fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8'),
      fs.readFile(path.join(RESUMES_DIR, 'cover_letter_template.tex'), 'utf8'),
      readSkillFiles(),
    ])

    const clProvider = req.body.provider || process.env.LLM_PROVIDER || 'claude'
    const clPrompt = buildClPrompt(jd, jobTitle, companyName, sweTex, clTemplate, skills)
    logPipeline({ event: 'cl_request', company: companyName, provider: clProvider, promptLen: clPrompt.length, prompt: clPrompt }).catch(() => {})

    const t1 = performance.now()
    let clResult
    try {
      clResult = clProvider === 'relay'
        ? await callRelay(clPrompt, process.env.RELAY_CL_MODEL || 'cerebras/zai-glm-4.7')
        : await runClaude(claudePath, clPrompt, __dirname)
    } catch (claudeErr) {
      logPipeline({ event: 'cl_llm_error', error: claudeErr.message }).catch(() => {})
      throw claudeErr
    }
    const t2 = performance.now()

    const rawTex = extractLatex(clResult.stdout)
    if (!rawTex) throw new Error(`LLM output did not contain valid LaTeX (stdout preview: ${clResult.stdout.slice(0, 300)})`)
    const newTex = graftPreamble(clTemplate, rawTex)
    logPipeline({ event: 'cl_llm_output', company: companyName, outputLen: newTex.length, rawOutput: clResult.stdout }).catch(() => {})

    await fs.writeFile(outTex, newTex, 'utf8')
    const pdflatexArgs = ['-interaction=nonstopmode', `-output-directory=${RESUMES_DIR}`, outTex]
    try {
      await execFileAsync('pdflatex', pdflatexArgs, { cwd: __dirname, timeout: 60_000 })
    } catch (pdfErr) {
      console.error('pdflatex FAILED (cover-letter). stdout:\n' + (pdfErr.stdout || '(empty)'))
      console.error('pdflatex stderr:\n' + (pdfErr.stderr || '(empty)'))
      console.error(`Failing .tex preserved at: ${outTex}`)
      throw pdfErr
    }
    const t3 = performance.now()

    const pdfBuffer = await fs.readFile(outPdf)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="Rohan_CL_${safe}.pdf"`)
    res.send(pdfBuffer)
    const t4 = performance.now()

    console.log(`[/cover-letter] Done: LLM ${((t2 - t1) / 1000).toFixed(1)}s | pdflatex ${((t3 - t2) / 1000).toFixed(1)}s | total ${((t4 - t0) / 1000).toFixed(1)}s | provider: ${clProvider}`)

    fs.unlink(outTex).catch(() => {})
    fs.unlink(outPdf).catch(() => {})
    cleanupPdflatex(path.join(RESUMES_DIR, `Rohan_CL_${safe}`)).catch(() => {})
    appendLedger({
      company:    companyName,
      title:      jobTitle,
      date:       new Date().toISOString().slice(0, 10),
      resumePath: null,
      clPath:     `resumes/Rohan_CL_${safe}.pdf`,
    }).catch(err => console.error('appendLedger /cover-letter error:', err.message))
  } catch (err) {
    console.error('/cover-letter error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/cold-message', async (req, res) => {
  const { jd, companyName = '', jobTitle = '' } = req.body
  if (!jd || typeof jd !== 'string' || jd.trim().length === 0) {
    return res.status(400).json({ error: 'jd is required' })
  }
  try {
    const sweTex = await fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8')
    const cmPrompt = buildColdMessagePrompt(jd, companyName, jobTitle, sweTex)
    const cmProvider = req.body.provider || process.env.LLM_PROVIDER || 'claude'
    const { stdout } = cmProvider === 'relay'
      ? await callRelay(cmPrompt, process.env.RELAY_MODEL || 'google/gemini-3.5-flash')
      : await runClaude(claudePath, cmPrompt, __dirname)
    res.json({ message: stdout.trim() })
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
  try {
    const sweTex = await fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8')
    const cePrompt = buildColdEmailPrompt(jd, companyName, jobTitle, sweTex)
    const ceProvider = req.body.provider || process.env.LLM_PROVIDER || 'claude'
    logPipeline({ event: 'cold_email_request', company: companyName, provider: ceProvider, prompt: cePrompt }).catch(() => {})
    const { stdout } = ceProvider === 'relay'
      ? await callRelay(cePrompt, process.env.RELAY_MODEL || 'google/gemini-3.5-flash')
      : await runClaude(claudePath, cePrompt, __dirname)
    const text = stdout.trim()
    const subjectMatch = text.match(/^Subject:\s*(.+)/)
    const subject = subjectMatch ? subjectMatch[1].trim() : `Application for ${jobTitle} at ${companyName}`.trim()
    const body = subjectMatch ? text.slice(subjectMatch[0].length).trim() : text
    logPipeline({ event: 'cold_email_output', company: companyName, rawOutput: stdout }).catch(() => {})
    res.json({ subject, body })
  } catch (err) {
    console.error('/cold-email error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { app, appendLedger }

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  ;(async () => {
    await maybeSpawnRelay()
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`JSeek Enhancer server running on http://127.0.0.1:${PORT}`)
      console.log(`Claude CLI: ${claudePath}`)
    })
  })()
}
