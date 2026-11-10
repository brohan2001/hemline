import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { JSDOM } from 'jsdom'
import { chromeMock } from './helpers/chrome-mock.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const siteConfigsCode = readFileSync(path.join(__dirname, '../site_configs.js'), 'utf8')
const contentScriptCode = readFileSync(path.join(__dirname, '../content_script.js'), 'utf8')

// detectSite() routes on window.location.hostname, so each mock needs a
// realistic URL for its platform.
const PLATFORM_URLS = {
  jseek:        'https://jseek.co/jobs/info/12345',
  linkedin:     'https://www.linkedin.com/jobs/view/12345',
  jobright:     'https://jobright.ai/jobs/info/12345',
  indeed:       'https://www.indeed.com/viewjob?jk=12345',
  glassdoor:    'https://www.glassdoor.com/job-listing/swe-12345.htm',
  greenhouse:   'https://boards.greenhouse.io/acme/jobs/12345',
  lever:        'https://jobs.lever.co/acme/12345',
  workday:      'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/12345',
  ziprecruiter: 'https://www.ziprecruiter.com/c/acme/job/12345',
  builtin:      'https://builtin.com/job/software-engineer/12345',
  wellfound:    'https://wellfound.com/jobs/12345',
  dice:         'https://www.dice.com/job-detail/12345',
  ashby:        'https://jobs.ashbyhq.com/acme/12345',
  icims:        'https://careers.icims.com/jobs/12345/swe/job',
  smartrecruiters: 'https://jobs.smartrecruiters.com/Acme/12345-swe',
  bamboohr:     'https://acme.bamboohr.com/careers/12345',
  jazzhr:       'https://acme.applytojob.com/apply/12345',
  rippling:     'https://jobs.rippling.com/acme/12345',
}

async function bootContentScript(slug, storageData = {}, responses = {}) {
  const html = readFileSync(path.join(__dirname, `mocks/${slug}.html`), 'utf8')
  const dom = new JSDOM(html, { url: PLATFORM_URLS[slug], runScripts: 'outside-only' })

  dom.window.chrome = chromeMock(storageData, responses)
  // JSDOM has no layout engine, so innerText is undefined; the click handlers read it.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent },
  })
  dom.window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) })
  dom.window.alert = () => {}

  dom.window.eval(siteConfigsCode)
  dom.window.eval(contentScriptCode)

  // init() awaits the storage promise before injecting; yield until it lands.
  for (let i = 0; i < 10 && !dom.window.document.getElementById('hemline-btn-row'); i++) {
    await new Promise(r => setTimeout(r, 10))
  }
  return dom
}

describe('content script boots with a stored profile', () => {
  it('still injects buttons when chrome.storage holds a saved profile', async () => {
    const dom = await bootContentScript('greenhouse', {
      llmProvider: 'relay',
      profile: { firstName: 'Jane', email: 'jane@example.com' },
    })
    expect(dom.window.document.getElementById('hemline-btn-row')).not.toBeNull()
    dom.window.close()
  })
})

describe('standalone background bridge', () => {
  it('Resume click sends TAILOR to the background and shows the match score', async () => {
    const dom = await bootContentScript('greenhouse', {}, {
      TAILOR: { filename: 'Jane_Doe_Resume_Acme.pdf', matchScore: 87 },
    })
    const row = dom.window.document.getElementById('hemline-btn-row')
    const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Resume')
    btn.click()
    for (let i = 0; i < 20 && !btn.textContent.includes('87%'); i++) await new Promise(r => setTimeout(r, 10))
    const tailor = dom.window.chrome.sent.find(m => m.op === 'TAILOR')
    expect(tailor.payload.jobDescription.length).toBeGreaterThan(0)
    expect(btn.textContent).toContain('87% match')
    dom.window.close()
  })

  it('disables buttons with a setup hint until a key and resume exist', async () => {
    const dom = await bootContentScript('greenhouse', {}, {
      STATUS: { backend: 'extension', hasKey: false, hasResume: false },
    })
    const buttons = Array.from(dom.window.document.querySelectorAll('#hemline-btn-row button'))
    expect(buttons.every(b => b.disabled)).toBe(true)
    expect(buttons[0].title).toMatch(/add an API key/)
    dom.window.close()
  })

  it('hides the Claude/Relay toggle unless the local server backend is selected', async () => {
    const dom = await bootContentScript('jseek')
    expect(dom.window.document.getElementById('hemline-llm-toggle')).toBeNull()
    dom.window.close()
  })
})

describe('content script button injection across all 18 platforms', () => {
  for (const slug of Object.keys(PLATFORM_URLS)) {
    it(`injects Resume, Resume & CL, Message, and Email buttons on ${slug}`, async () => {
      const dom = await bootContentScript(slug)
      const row = dom.window.document.getElementById('hemline-btn-row')
      expect(row, `[${slug}] hemline-btn-row was not injected`).not.toBeNull()

      const buttons = Array.from(row.querySelectorAll('button'))
      const labels = buttons.map(b => b.textContent)
      expect(labels).toContain('Resume')
      expect(labels).toContain('Resume & CL')
      expect(labels).toContain('Message')
      expect(labels).toContain('Email')
      expect(buttons.every(b => !b.disabled)).toBe(true)
      dom.window.close()
    })
  }
})

// Selection checkboxes are opt-in via the sidebar Batch Apply toggle.
describe('batch apply selection layer (jseek.co watchlist)', () => {
  it('injects a checkbox into every watchlist card and a floating apply bar', async () => {
    const dom = await bootContentScript('jseek', { batchApplyEnabled: true })
    const doc = dom.window.document

    const cards = doc.querySelectorAll('div.relative.flex.items-center.gap-3.rounded-md.px-2.py-2[class*="[contain:layout]"]')
    expect(cards.length).toBe(2)
    expect(doc.querySelectorAll('.hemline-select-box input[type="checkbox"]').length).toBe(2)
    expect(doc.getElementById('hemline-apply-bar')).not.toBeNull()
    expect(doc.getElementById('hemline-apply-go')).not.toBeNull()
    dom.window.close()
  })

  it('is idempotent — re-running features does not duplicate checkboxes', async () => {
    const dom = await bootContentScript('jseek', { batchApplyEnabled: true })
    const doc = dom.window.document
    const card = doc.querySelector('div.relative.flex.items-center[class*="[contain:layout]"]')
    // Each card holds exactly one checkbox even though runFeatures fires repeatedly.
    expect(card.querySelectorAll('.hemline-select-box').length).toBe(1)
    dom.window.close()
  })
})
