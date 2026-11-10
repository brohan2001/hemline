import { describe, it, expect } from 'vitest'
import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const EXT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Extensions only load in a persistent context, and not in old headless mode.
async function launchWithExtension() {
  return chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  })
}

describe('live UI injection', () => {
  it('injects #hemline-btn-row on a Greenhouse job posting', async () => {
    const ctx = await launchWithExtension()
    const page = await ctx.newPage()
    try {
      // boards.greenhouse.io redirects to job-boards.greenhouse.io; resolving
      // the first job href and navigating directly avoids new-tab click issues
      await page.goto('https://boards.greenhouse.io/anthropic', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const href = await page.locator('a[href*="/jobs/"]').first().getAttribute('href')
      expect(href).toBeTruthy()
      await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForSelector('#hemline-btn-row', { timeout: 20_000 })
      expect(await page.$('#hemline-btn-row')).not.toBeNull()
    } finally {
      await ctx.close()
    }
  }, 120_000)

  it('injects #hemline-btn-row on a Lever job posting', async () => {
    const ctx = await launchWithExtension()
    const page = await ctx.newPage()
    try {
      await page.goto('https://jobs.lever.co/palantir', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const href = await page.locator('a.posting-title, .posting-title a, a[href*="jobs.lever.co/palantir/"]').first().getAttribute('href')
      expect(href).toBeTruthy()
      await page.goto(new URL(href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForSelector('#hemline-btn-row', { timeout: 20_000 })
      expect(await page.$('#hemline-btn-row')).not.toBeNull()
    } finally {
      await ctx.close()
    }
  }, 120_000)

  // LinkedIn and Indeed gate job pages behind login walls and bot protection,
  // so injection there is best-effort: log the outcome, never fail the suite.
  it('attempts injection on LinkedIn (best-effort, bot protection expected)', async () => {
    const ctx = await launchWithExtension()
    const page = await ctx.newPage()
    try {
      await page.goto('https://www.linkedin.com/jobs/search/?keywords=software%20engineer', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(5000)
      console.log('[LinkedIn] #hemline-btn-row present:', (await page.$('#hemline-btn-row')) !== null)
    } catch (err) {
      console.warn('[LinkedIn] skipped:', err.message)
    } finally {
      await ctx.close()
    }
  }, 90_000)

  it('attempts injection on Indeed (best-effort, bot protection expected)', async () => {
    const ctx = await launchWithExtension()
    const page = await ctx.newPage()
    try {
      await page.goto('https://www.indeed.com/jobs?q=software+engineer', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(5000)
      console.log('[Indeed] #hemline-btn-row present:', (await page.$('#hemline-btn-row')) !== null)
    } catch (err) {
      console.warn('[Indeed] skipped:', err.message)
    } finally {
      await ctx.close()
    }
  }, 90_000)
})
