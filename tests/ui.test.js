import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { JSDOM } from 'jsdom'

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
}

function chromeMock() {
  return {
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: () => {},
    },
    storage: {
      local: {
        get: (_key, cb) => cb({}),
        set: () => {},
      },
    },
  }
}

async function bootContentScript(slug) {
  const html = readFileSync(path.join(__dirname, `mocks/${slug}.html`), 'utf8')
  const dom = new JSDOM(html, { url: PLATFORM_URLS[slug], runScripts: 'outside-only' })

  dom.window.chrome = chromeMock()
  // Healthy /health stub so pingHealth keeps the buttons enabled.
  dom.window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) })
  dom.window.alert = () => {}

  dom.window.eval(siteConfigsCode)
  dom.window.eval(contentScriptCode)

  // init() awaits the storage promise before injecting; yield until it lands.
  for (let i = 0; i < 10 && !dom.window.document.getElementById('jseek-btn-row'); i++) {
    await new Promise(r => setTimeout(r, 10))
  }
  return dom
}

describe('content script button injection across all 12 platforms', () => {
  for (const slug of Object.keys(PLATFORM_URLS)) {
    it(`injects Resume, Resume & CL, Message, and Email buttons on ${slug}`, async () => {
      const dom = await bootContentScript(slug)
      const row = dom.window.document.getElementById('jseek-btn-row')
      expect(row, `[${slug}] jseek-btn-row was not injected`).not.toBeNull()

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
