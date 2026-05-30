import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const FAKE_TEX = '\\documentclass{article}\\begin{document}hello\\end{document}'
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
    },
  }
})

import { app } from '../server.js'
import { execFile } from 'child_process'

beforeEach(() => {
  vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
    const child = { stdin: { end: vi.fn() } }
    process.nextTick(() => cb(null, FAKE_TEX, ''))
    return child
  })
})

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
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
