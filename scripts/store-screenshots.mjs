// Captures 1280x800 store-listing screenshots from the built Chrome extension.
// Add a real on-page screenshot (buttons on a LinkedIn/Greenhouse posting) by hand.
//   npm run build:chrome && node scripts/store-screenshots.mjs <feedDir> [outDir=store-assets]
// <feedDir> is a local output of scripts/build-feed.mjs (served in place of the
// GitHub Pages feed so screenshots work before Pages is live).
import { chromium } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXT = path.join(ROOT, 'dist', 'chrome')
const feedDir = process.argv[2]
const out = path.resolve(process.argv[3] ?? path.join(ROOT, 'store-assets'))
if (!feedDir || !existsSync(path.join(feedDir, 'jobs.json'))) {
  console.error('Usage: node scripts/store-screenshots.mjs <feedDir> [outDir]')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'jseek-shots-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
await context.route('https://brohan2001.github.io/resume-extension/**', route => {
  const rel = new URL(route.request().url()).pathname.replace('/resume-extension/', '')
  const file = path.join(feedDir, rel)
  return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 })
})
const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host

const sample = readFileSync(path.join(ROOT, 'templates', 'resume_template.tex'), 'utf8')
  .replace('{{NAME}}', 'Jane Doe')
  .replace('{{CONTACT_LINE}}', '555-010-0199 $|$ jane@example.com')

const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.screenshot({ path: path.join(out, '1-onboarding.png') })

await options.evaluate(async (tex) => {
  await chrome.storage.local.set({
    llmKeys: [{ provider: 'anthropic', key: 'sk-ant-demo', model: 'claude-opus-5-5' }, { provider: 'gemini', key: 'demo', model: 'gemini-3.5-flash' }],
    resumeTex: tex,
    profile: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
  })
}, sample)
await options.reload()
await options.click('#preview')
await options.waitForSelector('#pdf-preview:not([hidden])')
await options.waitForTimeout(4000)
await options.locator('#resume-section').scrollIntoViewIfNeeded()
await options.screenshot({ path: path.join(out, '2-resume-preview.png') })

const dash = await context.newPage()
await dash.goto(`chrome-extension://${extId}/dashboard.html`)
await dash.waitForSelector('.row')
await dash.click('.chip[data-chip="role"]')
await dash.click('#dd-role .ditem[data-val="backend"]')
await dash.waitForTimeout(300)
await dash.locator('.row').nth(1).click()
await dash.waitForTimeout(500)
await dash.click('#desc-toggle')
await dash.waitForTimeout(800)
await dash.screenshot({ path: path.join(out, '3-job-feed.png') })

await context.close()
console.log(`Screenshots written to ${out}`)
