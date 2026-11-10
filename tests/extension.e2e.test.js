// Loads the built extension (dist/chrome) into Chromium and drives the real
// service worker → offscreen document → WASM pdfTeX path. LLM HTTP calls are
// intercepted, so no API key or network quota is needed.
//   npm run build:chrome && JSEEK_E2E=1 npx vitest run tests/extension.e2e.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright'
import { readFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { shardOf } from '../pipeline/jobfilter.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXT = path.join(ROOT, 'dist', 'chrome')
const run = process.env.JSEEK_E2E ? describe : describe.skip

const TEMPLATE = readFileSync(path.join(ROOT, 'templates', 'resume_template.tex'), 'utf8')
const SKILLS = TEMPLATE.slice(TEMPLATE.indexOf('\\section{Technical Skills}'), TEMPLATE.indexOf('%-----------PROJECTS'))
const PROJECTS = TEMPLATE.slice(TEMPLATE.indexOf('\\section{Projects}'), TEMPLATE.indexOf('%-----------EXPERIENCE'))

const NOW = new Date().toISOString()
const FEED_JOBS = [
  { id: 'gh-1', title: 'Backend Engineer', company: 'Acme Corp', location: 'Remote, US', url: 'https://example.com/1', postedAt: NOW, remote: true, source: 'greenhouse', role: 'backend', level: 'mid', visa: 1, h1b: 120, score: 81 },
  { id: 'gh-2', title: 'Data Analyst', company: 'Globex', location: 'London, UK', url: 'https://example.com/2', postedAt: NOW, remote: false, source: 'lever', role: 'other', level: 'mid', visa: 0, h1b: null, score: 40 },
]
const FEED_DETAILS = { 'gh-1': { description: 'We need Python, Kubernetes and PostgreSQL.\n<script>alert(1)</script>', scores: { skill: 30, role: 25, visa: 20, recency: 10, company: 6, total: 81 } } }

run('built extension (Chromium)', () => {
  let context
  let extId
  let page
  const llmCalls = []

  beforeAll(async () => {
    context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'jseek-e2e-')), {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    })
    await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
      const body = JSON.parse(route.request().postData())
      llmCalls.push(body)
      await route.fulfill({ json: { choices: [{ message: { content: `${SKILLS}\n${PROJECTS}` } }] } })
    })
    await context.route('https://brohan2001.github.io/resume-extension/**', async (route) => {
      const url = route.request().url()
      if (url.endsWith('/jobs.json')) return route.fulfill({ json: { ts: NOW, total: FEED_JOBS.length, shards: 32, jobs: FEED_JOBS } })
      if (url.endsWith(`/details/${shardOf('gh-1')}.json`)) return route.fulfill({ json: FEED_DETAILS })
      return route.fulfill({ json: {} })
    })
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    extId = new URL(sw.url()).host
    page = await context.newPage()
    await page.goto(`chrome-extension://${extId}/options.html`)
  }, 60_000)

  afterAll(async () => { await context?.close() })

  // Passed as a string so vitest's transform doesn't rewrite the dynamic import.
  const bg = (op, payload) => page.evaluate(`(async () => {
    const { callBackground } = await import('./bridge.js')
    try { return { ok: true, result: await callBackground(${JSON.stringify(op)}, ${JSON.stringify(payload ?? {})}) } }
    catch (e) { return { ok: false, error: e.message, latexError: e.latexError } }
  })()`)

  it('options page renders the onboarding checklist', async () => {
    expect(await page.locator('#checklist li').count()).toBe(3)
    expect(await page.locator('.key-row').count()).toBe(1)
  })

  it('reports not-ready until a key and resume are stored', async () => {
    expect((await bg('STATUS')).result).toEqual({ backend: 'extension', hasKey: false, hasResume: false })
  })

  it('compiles the bundled template to a one-page PDF with WASM pdfTeX', async () => {
    const { result, ok, error } = await bg('PREVIEW_TEX', { tex: TEMPLATE.replace('{{NAME}}', 'Jane Doe').replace('{{CONTACT_LINE}}', 'jane@example.com') })
    expect(error).toBeUndefined()
    expect(ok).toBe(true)
    expect(result.pages).toBe(1)
    expect(Buffer.from(result.pdf, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  }, 90_000)

  it('surfaces the LaTeX error line for a broken document', async () => {
    const broken = TEMPLATE.replace('\\begin{document}', '\\begin{document}\n\\undefinedmacro')
    const r = await bg('PREVIEW_TEX', { tex: broken })
    expect(r.ok).toBe(false)
    expect(r.latexError.message).toMatch(/Undefined control sequence/)
    expect(r.latexError.line).toBeGreaterThan(0)
  }, 90_000)

  it('tailors a resume end to end with a (mocked) Gemini key', async () => {
    await page.evaluate(async (tex) => {
      await chrome.storage.local.set({
        llmKeys: [{ provider: 'gemini', key: 'test-key', model: 'gemini-3.5-flash' }],
        resumeTex: tex,
        profile: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
      })
    }, TEMPLATE.replace('{{NAME}}', 'Jane Doe').replace('{{CONTACT_LINE}}', 'jane@example.com'))

    expect((await bg('STATUS')).result).toEqual({ backend: 'extension', hasKey: true, hasResume: true })
    const r = await bg('TAILOR', { jobDescription: 'Backend role: Python, Kubernetes, Docker, AWS, PostgreSQL.', companyName: 'Acme Corp', jobTitle: 'SWE', download: false })
    expect(r.error).toBeUndefined()
    expect(r.result.filename).toBe('Jane_Doe_Resume_Acme_Corp.pdf')
    expect(r.result.matchScore).toBeGreaterThan(0)
    expect(llmCalls.at(-1).messages[0].content).toContain('Backend role')

    const stored = await bg('GET_PDF', { name: 'resume' })
    expect(Buffer.from(stored.result, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
    const dup = await bg('CHECK_DUPLICATE', { company: 'acme corp', title: 'swe' })
    expect(dup.result.duplicate).toBe(true)
  }, 120_000)

  it('dashboard filters the hosted feed and tailors from the detail panel', async () => {
    const dash = await context.newPage()
    await dash.goto(`chrome-extension://${extId}/dashboard.html`)
    await dash.waitForSelector('.row[data-id="gh-1"]')
    // Default "US & Remote" filter hides the London posting.
    expect(await dash.locator('.row').count()).toBe(1)
    await dash.click('.row[data-id="gh-1"]')
    await dash.waitForFunction(() => document.getElementById('panel-desc').textContent.includes('Kubernetes'))
    // Descriptions render as text, never HTML.
    expect(await dash.locator('#panel-desc script').count()).toBe(0)
    expect(await dash.textContent('#health-line')).toContain('ready')
    await dash.click('#btn-resume')
    await dash.waitForFunction(() => /match/.test(document.getElementById('status').textContent), null, { timeout: 60_000 })
    expect(await dash.textContent('#status')).toContain('Jane_Doe_Resume_Acme_Corp.pdf')
    await dash.close()
  }, 90_000)

  it('on-page Resume button on a Greenhouse posting tailors and downloads the PDF', async () => {
    const mock = readFileSync(path.join(ROOT, 'tests', 'mocks', 'greenhouse.html'), 'utf8')
    await context.route('https://boards.greenhouse.io/**', route => route.fulfill({ contentType: 'text/html', body: mock }))
    const job = await context.newPage()
    await job.goto('https://boards.greenhouse.io/acme/jobs/12345')
    const btn = job.locator('#jseek-btn-row button', { hasText: /^Resume$/ })
    await btn.waitFor()
    expect(await btn.isDisabled()).toBe(false)
    job.on('dialog', d => d.accept())
    await btn.click()
    await job.waitForFunction(() => [...document.querySelectorAll('#jseek-btn-row button')].some(b => /match|✓/.test(b.textContent)), null, { timeout: 60_000 })
    const label = await job.locator('#jseek-btn-row button').first().textContent()
    expect(label).toMatch(/Resume ✓ \d+% match|_Resume_.*\.pdf ✓/)
    const downloads = await page.evaluate(() => new Promise(r => chrome.downloads.search({}, r)))
    // Playwright stores intercepted downloads under GUID names, so check the
    // payload type instead; the button label above carries the real filename.
    const pdfs = downloads.filter(d => d.mime === 'application/pdf' && d.state !== 'interrupted')
    expect(pdfs.length).toBeGreaterThanOrEqual(2)
    await job.close()
  }, 90_000)
})

