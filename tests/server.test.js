import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import path from 'path'

const VALID_SKILLS_BLOCK = `\\section{Technical Skills}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
     \\textbf{Languages}{: Python, Java, JavaScript, TypeScript, Golang, C/C++, Bash, SQL} \\\\
     \\textbf{Frameworks}{: PyTorch, TensorFlow, Scikit-learn, Pandas, NumPy, Llama, NeMo, Hugging Face} \\\\
     \\textbf{Cloud}{: AWS, GCP, Azure, Docker, Kubernetes, Terraform, GitHub Actions, CI/CD, Jenkins} \\\\
     \\textbf{Tools}{: Git, Linux, Bash Scripting, Jupyter, Apache Spark, MLflow, PostgreSQL, Redis} \\\\
     \\textbf{Courses}{: Machine Learning, Natural Language Processing, Data Structures, Algorithms, Deep Learning, Probability and Statistics, Data Science, Computer Vision, Operating Systems}\\\\
    }}
 \\end{itemize}`

const FAKE_TEX = `\\documentclass{article}\\begin{document}\n${VALID_SKILLS_BLOCK}\nhello\\end{document}`
const FAKE_PDF = Buffer.from('%PDF-1.4 fake')

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    execFile: vi.fn(),
    execSync: vi.fn(() => Buffer.from('/usr/local/bin/claude')),
  }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(async (p) => {
        if (String(p).endsWith('.pdf')) return FAKE_PDF
        return FAKE_TEX
      }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      unlink: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      appendFile: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
    },
  }
})

import { app, computeMatchScore } from '../server.js'
import { execFile } from 'child_process'
import { promises as fsp } from 'fs'

beforeEach(() => {
  vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
    const child = { stdin: { end: vi.fn() } }
    process.nextTick(() => cb(null, FAKE_TEX, ''))
    return child
  })
})

describe('GET /health', () => {
  it('returns 200 ok with provider and relay status', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.provider).toBe('string')
    expect(typeof res.body.relayUp).toBe('boolean')
    expect(typeof res.body.pdflatexFound).toBe('boolean')
  })
})

describe('GET /stats', () => {
  it('aggregates request and model events from pipeline.log', async () => {
    const LOG = [
      JSON.stringify({ ts: '2026-06-10T10:00:00Z', event: 'request_complete', endpoint: '/tailor', totalMs: 10000, llmMs: 8000 }),
      JSON.stringify({ ts: '2026-06-10T11:00:00Z', event: 'request_complete', endpoint: '/tailor', totalMs: 20000, llmMs: 16000 }),
      JSON.stringify({ ts: '2026-06-10T12:00:00Z', event: 'request_error', endpoint: '/tailor', error: 'boom' }),
      JSON.stringify({ ts: '2026-06-10T12:05:00Z', event: 'relay_fail', model: 'google/gemini-3.5-flash', error: 'x' }),
      'not json',
    ].join('\n')
    vi.mocked(fsp.readFile).mockImplementationOnce(async () => LOG)
    const res = await request(app).get('/stats')
    expect(res.status).toBe(200)
    expect(res.body.requests['/tailor'].count).toBe(2)
    expect(res.body.requests['/tailor'].errors).toBe(1)
    expect(res.body.requests['/tailor'].avgTotalMs).toBe(15000)
    expect(res.body.models['google/gemini-3.5-flash'].fail).toBe(1)
    expect(res.body.byDay['2026-06-10']).toBe(2)
  })

  it('returns empty aggregates when the log is missing', async () => {
    vi.mocked(fsp.readFile).mockImplementationOnce(async () => { throw new Error('ENOENT') })
    const res = await request(app).get('/stats')
    expect(res.status).toBe(200)
    expect(res.body.requests).toEqual({})
  })
})

describe('POST /tailor', () => {
  it('returns 400 when jobDescription is missing', async () => {
    const res = await request(app).post('/tailor').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 when jobDescription is empty string', async () => {
    const res = await request(app).post('/tailor').send({ jobDescription: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns PDF on valid request', async () => {
    const res = await request(app)
      .post('/tailor')
      .send({ jobDescription: 'ML engineer role requiring Python and TensorFlow', companyName: 'Acme', jobTitle: 'SWE' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
    expect(res.headers['x-jseek-match-score']).toMatch(/^\d+$/)
  })

  it('never writes to the master swe.tex (compiles in resumes/build)', async () => {
    vi.mocked(fsp.writeFile).mockClear()
    const res = await request(app)
      .post('/tailor')
      .send({ jobDescription: 'ML engineer role', companyName: 'Acme', jobTitle: 'SWE' })
    expect(res.status).toBe(200)
    const writtenPaths = vi.mocked(fsp.writeFile).mock.calls.map(c => String(c[0]))
    const masterWrites = writtenPaths.filter(p => p.endsWith(path.join('resumes', 'swe.tex')))
    expect(masterWrites).toEqual([])
    expect(writtenPaths.some(p => p.includes(path.join('build', 'swe.tex')))).toBe(true)
  })

  it('retries the LLM once when the skills block violates constraints', async () => {
    const INVALID_TEX = FAKE_TEX.replace(
      '\\textbf{Frameworks}{: PyTorch, TensorFlow, Scikit-learn, Pandas, NumPy, Llama, NeMo, Hugging Face}',
      '\\textbf{Frameworks}{: PyTorch, TensorFlow, Scikit-learn, Pandas, NumPy, Llama, NeMo, Hugging Face, Keras, JAX, XGBoost, LightGBM, OpenCV, Transformers}'
    )
    vi.mocked(execFile).mockClear()
    vi.mocked(execFile).mockImplementationOnce((_b, _a, _o, cb) => {
      const child = { stdin: { end: vi.fn() } }
      process.nextTick(() => cb(null, INVALID_TEX, ''))
      return child
    })
    const res = await request(app)
      .post('/tailor')
      .send({ jobDescription: 'ML engineer role', companyName: 'Acme', jobTitle: 'SWE' })
    expect(res.status).toBe(200)
    // invalid first attempt + valid retry + pdflatex = 3 execFile calls
    expect(vi.mocked(execFile).mock.calls.length).toBe(3)
  })

  it('serializes concurrent tailor requests through the pipeline mutex', async () => {
    let inFlight = false
    let overlapped = false
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      if (inFlight) overlapped = true
      inFlight = true
      setTimeout(() => {
        inFlight = false
        cb(null, FAKE_TEX, '')
      }, 20)
      return { stdin: { end: vi.fn() } }
    })
    const [a, b] = await Promise.all([
      request(app).post('/tailor').send({ jobDescription: 'role one', companyName: 'A' }),
      request(app).post('/tailor').send({ jobDescription: 'role two', companyName: 'B' }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(overlapped).toBe(false)
  })
})

describe('LaTeX error surfacing', () => {
  it('returns structured latexError when pdflatex fails', async () => {
    vi.mocked(execFile)
      .mockImplementationOnce((_b, _a, _o, cb) => {
        const child = { stdin: { end: vi.fn() } }
        process.nextTick(() => cb(null, FAKE_TEX, ''))
        return child
      })
      .mockImplementationOnce((_b, _a, _o, cb) => {
        const child = { stdin: { end: vi.fn() } }
        const err = new Error('Command failed: pdflatex')
        err.stdout = 'This is pdfTeX\n! Undefined control sequence.\n<recently read> \\badmacro\nl.42 \\badmacro\n'
        process.nextTick(() => cb(err, err.stdout, ''))
        return child
      })
    const res = await request(app)
      .post('/tailor')
      .send({ jobDescription: 'ML engineer role', companyName: 'Acme', jobTitle: 'SWE' })
    expect(res.status).toBe(500)
    expect(res.body.latexError.message).toBe('Undefined control sequence.')
    expect(res.body.latexError.line).toBe(42)
  })
})

describe('POST /cover-letter', () => {
  it('returns 400 when jd is missing', async () => {
    const res = await request(app).post('/cover-letter').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 when jd is empty string', async () => {
    const res = await request(app).post('/cover-letter').send({ jd: '' })
    expect(res.status).toBe(400)
  })

  it('returns PDF on valid request', async () => {
    const res = await request(app)
      .post('/cover-letter')
      .send({ jd: 'ML engineer role', companyName: 'Acme', jobTitle: 'SWE' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
  })
})

describe('POST /cold-message', () => {
  it('returns 400 when jd is missing', async () => {
    const res = await request(app).post('/cold-message').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns message string on valid request', async () => {
    vi.mocked(execFile).mockImplementationOnce((_b, _a, _o, cb) => {
      const child = { stdin: { end: vi.fn() } }
      process.nextTick(() => cb(null, 'Built SadTalker lip-sync pipeline at Stony Brook. Four concise sentences here.', ''))
      return child
    })
    const res = await request(app)
      .post('/cold-message')
      .send({ jd: 'ML engineer role', companyName: 'Acme', jobTitle: 'ML Eng' })
    expect(res.status).toBe(200)
    expect(typeof res.body.message).toBe('string')
    expect(res.body.message.length).toBeGreaterThan(0)
  })
})

describe('computeMatchScore', () => {
  it('scores keyword coverage of the tailored tex', () => {
    const jd = 'kubernetes kubernetes kubernetes terraform terraform golang golang'
    const tex = 'Skills: Kubernetes, Terraform, Python'
    const m = computeMatchScore(jd, tex)
    expect(m.score).toBe(67)
    expect(m.matched).toEqual(expect.arrayContaining(['kubernetes', 'terraform']))
    expect(m.missing).toEqual(['golang'])
  })

  it('returns 0 for an empty or all-stopword JD', () => {
    expect(computeMatchScore('the and with you will', 'anything').score).toBe(0)
  })
})

describe('application ledger endpoints', () => {
  const today = new Date().toISOString().slice(0, 10)
  const old = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
  const LEDGER = JSON.stringify([
    { company: 'Acme', title: 'SWE', date: today, resumePath: 'resumes/r.pdf', clPath: null },
    { company: 'Stale Corp', title: 'SWE', date: old, resumePath: 'resumes/r.pdf', clPath: null },
  ])

  beforeEach(() => {
    vi.mocked(fsp.readFile).mockImplementation(async (p) => {
      if (String(p).endsWith('applied_jobs.json')) return LEDGER
      if (String(p).endsWith('.pdf')) return FAKE_PDF
      return FAKE_TEX
    })
  })

  it('GET /applications returns the ledger with count', async () => {
    const res = await request(app).get('/applications')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.applications[0].company).toBe('Acme')
  })

  it('GET /applications/check flags a recent duplicate (case-insensitive)', async () => {
    const res = await request(app).get('/applications/check?company=acme')
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(res.body.lastDate).toBe(today)
    expect(res.body.timesApplied).toBe(1)
  })

  it('GET /applications/check ignores applications older than 30 days', async () => {
    const res = await request(app).get('/applications/check?company=Stale%20Corp')
    expect(res.body.duplicate).toBe(false)
  })

  it('GET /applications/check returns false for unknown company', async () => {
    const res = await request(app).get('/applications/check?company=nonexistent')
    expect(res.body.duplicate).toBe(false)
  })

  it('GET /applications/check requires company param', async () => {
    const res = await request(app).get('/applications/check')
    expect(res.status).toBe(400)
  })
})

describe('POST /cold-email', () => {
  it('returns 400 when jd is missing', async () => {
    const res = await request(app).post('/cold-email').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns subject and body on valid request', async () => {
    vi.mocked(execFile).mockImplementationOnce((_b, _a, _o, cb) => {
      const child = { stdin: { end: vi.fn() } }
      process.nextTick(() => cb(null, 'Subject: SWE Application\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.\n\nBest regards,\nRohan Balasubramanian', ''))
      return child
    })
    const res = await request(app)
      .post('/cold-email')
      .send({ jd: 'ML engineer role', companyName: 'Acme', jobTitle: 'ML Eng' })
    expect(res.status).toBe(200)
    expect(res.body.subject).toBe('SWE Application')
    expect(res.body.body).toContain('Paragraph one.')
    expect(res.body.body).not.toContain('Subject:')
  })

  it('falls back to a default subject when LLM omits the Subject line', async () => {
    vi.mocked(execFile).mockImplementationOnce((_b, _a, _o, cb) => {
      const child = { stdin: { end: vi.fn() } }
      process.nextTick(() => cb(null, 'Paragraph one without a subject line.', ''))
      return child
    })
    const res = await request(app)
      .post('/cold-email')
      .send({ jd: 'ML engineer role', companyName: 'Acme', jobTitle: 'ML Eng' })
    expect(res.status).toBe(200)
    expect(res.body.subject).toBe('Application for ML Eng at Acme')
    expect(res.body.body).toContain('Paragraph one')
  })
})

const RELAY_RESPONSE = {
  choices: [{ message: { content: FAKE_TEX } }],
}

describe('relay provider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve(RELAY_RESPONSE),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POST /tailor routes to relay when provider sent in body', async () => {
    const res = await request(app)
      .post('/tailor')
      .send({ jobDescription: 'ML engineer role requiring Python', companyName: 'Acme', jobTitle: 'SWE', provider: 'relay' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
  })

  it('POST /cover-letter routes to relay when provider sent in body', async () => {
    const res = await request(app)
      .post('/cover-letter')
      .send({ jd: 'ML engineer role', companyName: 'Acme', jobTitle: 'SWE', provider: 'relay' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
  })

  it('POST /cold-message routes to relay when provider sent in body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Built SadTalker lip-sync pipeline at Stony Brook. Four concise sentences here.' } }],
      }),
    }))
    const res = await request(app)
      .post('/cold-message')
      .send({ jd: 'ML engineer role', companyName: 'Acme', jobTitle: 'ML Eng', provider: 'relay' })
    expect(res.status).toBe(200)
    expect(typeof res.body.message).toBe('string')
    expect(res.body.message.length).toBeGreaterThan(0)
  })

  it('body provider takes precedence over LLM_PROVIDER env var', async () => {
    process.env.LLM_PROVIDER = 'claude'
    const res = await request(app)
      .post('/tailor')
      .send({ jobDescription: 'ML engineer role', companyName: 'Acme', jobTitle: 'SWE', provider: 'relay' })
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalled()
    delete process.env.LLM_PROVIDER
  })
})
