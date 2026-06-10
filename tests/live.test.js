import { describe, it, expect } from 'vitest'
import { readdir, stat } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:4567'
const RESUMES_DIR = path.resolve(__dirname, '..', 'resumes')

const SAMPLE_JD = `Senior Software Engineer at Acme Corp.
Skills required: Python, TypeScript, distributed systems, Kubernetes.
Responsibilities: Design and operate high-throughput data pipelines serving 10M daily users.
Build scalable microservices on AWS. Collaborate with cross-functional teams on ML infrastructure.`

describe('live /tailor', () => {
  it('returns a valid PDF and writes swe.pdf to disk', async () => {
    const res = await fetch(`${BASE}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobDescription: SAMPLE_JD,
        companyName: 'Acme Corp',
        jobTitle: 'Senior Software Engineer',
      }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/pdf')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
    const info = await stat(path.join(RESUMES_DIR, 'swe.pdf'))
    expect(info.size).toBeGreaterThan(1000)
  }, 300_000)
})

describe('live /cover-letter', () => {
  it('returns a valid PDF and cleans up generated files from disk', async () => {
    const res = await fetch(`${BASE}/cover-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd: SAMPLE_JD,
        companyName: 'Acme Corp',
        jobTitle: 'Senior Software Engineer',
      }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/pdf')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
    // Generated Rohan_CL_*.tex and Rohan_CL_*.pdf are deleted after being sent
    await new Promise(r => setTimeout(r, 500))
    const after = await readdir(RESUMES_DIR)
    const leftoverCl = after.filter(f => f.startsWith('Rohan_CL_') && (f.endsWith('.pdf') || f.endsWith('.tex')))
    expect(leftoverCl.length).toBe(0)
  }, 300_000)
})

describe('live /cold-message', () => {
  it('returns a non-empty cold message string', async () => {
    const res = await fetch(`${BASE}/cold-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd: SAMPLE_JD,
        companyName: 'Acme Corp',
        jobTitle: 'Senior Software Engineer',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.message).toBe('string')
    expect(body.message.trim().length).toBeGreaterThan(20)
  }, 120_000)
})
