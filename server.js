import express from 'express'
import cors from 'cors'
import { execSync, execFile } from 'child_process'
import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { promisify } from 'util'

// BasicTeX installs pdflatex to /Library/TeX/texbin which is not in Node's
// inherited PATH on macOS when launched outside a login shell.
if (process.platform === 'darwin' && !process.env.PATH?.includes('/Library/TeX/texbin')) {
  process.env.PATH = `/Library/TeX/texbin:${process.env.PATH}`
}

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4567
const RESUMES_DIR = path.join(__dirname, 'resumes')

let claudePath = 'claude'
if (process.env.NODE_ENV !== 'test') {
  try {
    claudePath = execSync('which claude').toString().trim()
  } catch {
    console.error('Warning: claude CLI not found on PATH. /tailor endpoint will fail.')
    claudePath = 'claude'
  }
}

function buildResumePrompt(jobDescription, sweTex, skills) {
  const skillsBlock = Object.entries(skills)
    .map(([name, content]) => `<${name}>\n${content}\n</${name}>`)
    .join('\n\n')

  return `You are editing a LaTeX resume. Your output must be the complete, valid LaTeX source — nothing else.

Here is the current resumes/swe.tex:
<swe_tex>
${sweTex}
</swe_tex>

Here are the skill pools:
${skillsBlock}

The target job description is:
<job_description>
${jobDescription.trim()}
</job_description>

Update ONLY the Technical Skills section with these strict constraints:
- Exactly 5 skill headings total.
- Row 1 heading must be "Languages".
- Rows 2, 3, and 4: choose headings that best match the job description (e.g., "Frameworks", "Developer Tools", "Libraries", "Cloud & DevOps").
- Row 5 heading must be "Courses" and must span exactly 2 physical lines in the LaTeX source.
- Pull skills from the skill pools that match keywords in the job description.
- Add any critical missing skills explicitly required by the job description (e.g., Docker, Kubernetes) if not already present.
- Every physical line of skills content (ignoring LaTeX markup like \\textbf{}, \\item, \\\\) must produce <= 105 characters of visible PDF text.
- Do not modify any other section.

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

function sep(label) {
  const bar = '='.repeat(64)
  console.log(`\n${bar}\n=== DEBUG: ${label} ===\n${bar}`)
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

function sanitizeFilename(name) {
  return (name ?? '').replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Company'
}

async function cleanupPdflatex(basePath) {
  for (const ext of ['.aux', '.log', '.out', '.pdf']) {
    await fs.unlink(basePath + ext).catch(() => {})
  }
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

// stdin is closed immediately to prevent a 3 s wait for piped input.
function runClaude(bin, prompt, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, ['-p', prompt, '--dangerously-skip-permissions'], {
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

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

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
    sep('STAGE 1 — Scraped Job Description')
    console.log(`  Company        : ${companyName || '(not provided)'}`)
    console.log(`  Job Title      : ${jobTitle || '(not provided)'}`)
    console.log(`  Payload length : ${jobDescription.length} characters`)
    console.log(`  First 200 chars: ${jobDescription.trim().slice(0, 200)}`)

    sep('STAGE 2 — Pre-reading files')
    const [sweTex, skills] = await Promise.all([
      fs.readFile(texFile, 'utf8'),
      readSkillFiles(),
    ])
    console.log(`  swe.tex size : ${sweTex.length} bytes`)
    console.log('  Technical Skills section (before):')
    console.log(extractSkillsSection(sweTex))
    console.log(`  Skill files  : ${Object.keys(skills).join(', ')}`)

    sep('STAGE 3 — Claude Execution')
    console.log(`  Binary : ${claudePath}`)
    let claudeResult
    try {
      claudeResult = await runClaude(claudePath, buildResumePrompt(jobDescription, sweTex, skills), __dirname)
    } catch (claudeErr) {
      console.log(`  Claude exited with error (code ${claudeErr.code}):`)
      console.log(`  stdout: ${claudeErr.stdout || '(empty)'}`)
      console.log(`  stderr: ${claudeErr.stderr || '(empty)'}`)
      throw claudeErr
    }
    console.log(`  Claude stderr: ${claudeResult.stderr || '(empty)'}`)

    const newTex = extractLatex(claudeResult.stdout)
    if (!newTex) throw new Error(`Claude output did not contain valid LaTeX (stdout preview: ${claudeResult.stdout.slice(0, 300)})`)
    console.log(`  Output size  : ${newTex.length} bytes`)
    console.log('  Technical Skills section (after):')
    console.log(extractSkillsSection(newTex))

    sep('STAGE 4 — Writing swe.tex')
    await fs.writeFile(texFile, newTex, 'utf8')

    sep('STAGE 5 — pdflatex Compilation')
    const pdflatexArgs = ['-interaction=nonstopmode', `-output-directory=${RESUMES_DIR}`, texFile]
    console.log(`  Command: pdflatex ${pdflatexArgs.join(' ')}`)
    const latexResult = await execFileAsync('pdflatex', pdflatexArgs, { cwd: __dirname, timeout: 60_000 })
    console.log(`  pdflatex stdout:\n${latexResult.stdout}`)

    sep('PIPELINE COMPLETE — sending PDF')
    const pdfBuffer = await fs.readFile(pdfFile)
    console.log(`  PDF size: ${pdfBuffer.length} bytes`)
    await cleanupPdflatex(path.join(RESUMES_DIR, 'swe'))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="Rohan_Resume_${safe}.pdf"`)
    res.send(pdfBuffer)
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
    sep('CL STAGE 1 — Request')
    console.log(`  Company   : ${companyName || '(not provided)'}`)
    console.log(`  Job Title : ${jobTitle || '(not provided)'}`)
    console.log(`  Out file  : ${outTex}`)
    console.log(`  JD length : ${jd.length} characters`)

    sep('CL STAGE 2 — Pre-reading files')
    const [sweTex, clTemplate, skills] = await Promise.all([
      fs.readFile(path.join(RESUMES_DIR, 'swe.tex'), 'utf8'),
      fs.readFile(path.join(RESUMES_DIR, 'cover_letter_template.tex'), 'utf8'),
      readSkillFiles(),
    ])
    console.log(`  swe.tex size  : ${sweTex.length} bytes`)
    console.log(`  template size : ${clTemplate.length} bytes`)
    console.log(`  Skill files   : ${Object.keys(skills).join(', ')}`)

    sep('CL STAGE 3 — Claude Execution')
    console.log(`  Binary : ${claudePath}`)
    let clResult
    try {
      clResult = await runClaude(claudePath, buildClPrompt(jd, jobTitle, companyName, sweTex, clTemplate, skills), __dirname)
    } catch (claudeErr) {
      console.log(`  Claude error (code ${claudeErr.code}):`)
      console.log(`  stdout: ${claudeErr.stdout || '(empty)'}`)
      console.log(`  stderr: ${claudeErr.stderr || '(empty)'}`)
      throw claudeErr
    }
    console.log(`  Claude stderr: ${clResult.stderr || '(empty)'}`)

    const newTex = extractLatex(clResult.stdout)
    if (!newTex) throw new Error(`Claude output did not contain valid LaTeX (stdout preview: ${clResult.stdout.slice(0, 300)})`)
    console.log(`  Output size : ${newTex.length} bytes`)

    sep('CL STAGE 4 — Writing .tex & Compilation')
    await fs.writeFile(outTex, newTex, 'utf8')
    const pdflatexArgs = ['-interaction=nonstopmode', `-output-directory=${RESUMES_DIR}`, outTex]
    console.log(`  Command: pdflatex ${pdflatexArgs.join(' ')}`)
    const latexResult = await execFileAsync('pdflatex', pdflatexArgs, { cwd: __dirname, timeout: 60_000 })
    console.log(`  pdflatex stdout:\n${latexResult.stdout}`)

    sep('CL PIPELINE COMPLETE — sending PDF')
    const pdfBuffer = await fs.readFile(outPdf)
    console.log(`  PDF size: ${pdfBuffer.length} bytes`)
    await cleanupPdflatex(path.join(RESUMES_DIR, `Rohan_CL_${safe}`))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="Rohan_CL_${safe}.pdf"`)
    res.send(pdfBuffer)
  } catch (err) {
    console.error('/cover-letter error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { app }

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`JSeek Enhancer server running on http://127.0.0.1:${PORT}`)
    console.log(`Claude CLI: ${claudePath}`)
  })
}
