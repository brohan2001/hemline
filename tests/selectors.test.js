// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load SITE_CONFIGS from site_configs.js via Function evaluation.
// site_configs.js is a plain browser script (no ES module exports), so we
// evaluate it in a function scope and return the var it defines.
const siteConfigsCode = readFileSync(path.join(__dirname, '../site_configs.js'), 'utf8')
const SITE_CONFIGS = new Function(siteConfigsCode + '\nreturn SITE_CONFIGS')()

function loadMock(platform) {
  return readFileSync(path.join(__dirname, `mocks/${platform}.html`), 'utf8')
}

// querySelector handles comma-separated selectors natively.
function queryElements(cfg) {
  return {
    jobDescription: document.querySelector(cfg.jobDescription),
    jobTitle:       document.querySelector(cfg.jobTitle),
    companyName:    document.querySelector(cfg.companyName),
    injectTarget:   document.querySelector(cfg.injectTarget),
  }
}

const PLATFORMS = [
  'jseek', 'linkedin', 'jobright', 'indeed',
  'glassdoor', 'greenhouse', 'lever', 'workday',
  'ziprecruiter', 'builtin', 'wellfound', 'dice',
]

describe('SITE_CONFIGS selector validation', () => {
  for (const slug of PLATFORMS) {
    describe(slug, () => {
      let els

      beforeEach(() => {
        document.documentElement.innerHTML = loadMock(slug)
        els = queryElements(SITE_CONFIGS[slug])
      })

      it('finds jobDescription', () => {
        expect(
          els.jobDescription,
          `[${slug}] jobDescription "${SITE_CONFIGS[slug].jobDescription}" found no element`
        ).not.toBeNull()
        expect(els.jobDescription.textContent.trim().length).toBeGreaterThan(0)
      })

      it('finds jobTitle', () => {
        expect(
          els.jobTitle,
          `[${slug}] jobTitle "${SITE_CONFIGS[slug].jobTitle}" found no element`
        ).not.toBeNull()
        expect(els.jobTitle.textContent.trim().length).toBeGreaterThan(0)
      })

      it('finds companyName', () => {
        expect(
          els.companyName,
          `[${slug}] companyName "${SITE_CONFIGS[slug].companyName}" found no element`
        ).not.toBeNull()
        expect(els.companyName.textContent.trim().length).toBeGreaterThan(0)
      })

      it('finds injectTarget', () => {
        expect(
          els.injectTarget,
          `[${slug}] injectTarget "${SITE_CONFIGS[slug].injectTarget}" found no element`
        ).not.toBeNull()
      })
    })
  }
})
