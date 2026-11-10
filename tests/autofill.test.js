import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { JSDOM } from 'jsdom'
import { chromeMock } from './helpers/chrome-mock.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const siteConfigsCode = readFileSync(path.join(__dirname, '../site_configs.js'), 'utf8')
const contentScriptCode = readFileSync(path.join(__dirname, '../content_script.js'), 'utf8')

// A greenhouse-style page (an ATS slug) carrying a form with one of every input
// type the auto-filler must handle.
const FORM_HTML = `<!DOCTYPE html><html><head><title>Acme Corp</title></head><body>
  <div class="job__title"><h1>Senior Software Engineer</h1></div>
  <div class="job__description"><p>Requirements: 3+ years experience.</p></div>
  <form>
    <label for="fn">First Name</label><input id="fn" name="first_name">
    <label for="em">Email</label><input id="em" name="email" type="email">
    <label for="cy">City</label><input id="cy" name="city">
    <label for="gd">Gender</label><input id="gd" name="gender">

    <label for="edu">Highest Education Level</label>
    <select id="edu" name="education_level">
      <option value="">Select…</option>
      <option value="High School">High School</option>
      <option value="Bachelor's Degree">Bachelor's Degree</option>
      <option value="Master's Degree">Master's Degree</option>
    </select>

    <fieldset>
      <legend>Will you require visa sponsorship?</legend>
      <label><input type="radio" name="visa_sponsorship" value="Yes">Yes</label>
      <label><input type="radio" name="visa_sponsorship" value="No">No</label>
    </fieldset>

    <label><input type="checkbox" name="agree_terms">I agree to the terms</label>
    <label><input type="checkbox" name="newsletter">Send me a newsletter</label>
  </form>
</body></html>`

async function bootForm(profile) {
  const dom = new JSDOM(FORM_HTML, {
    url: 'https://boards.greenhouse.io/acme/jobs/12345',
    runScripts: 'outside-only',
  })
  dom.window.chrome = chromeMock({ profile })
  dom.window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) })
  dom.window.alert = () => {}
  dom.window.eval(siteConfigsCode)
  dom.window.eval(contentScriptCode)
  // Wait until init() has injected the Auto-Fill button (ATS slug) and set PROFILE.
  for (let i = 0; i < 20 && !dom.window.document.getElementById('jseek-autofill-btn'); i++) {
    await new Promise(r => setTimeout(r, 10))
  }
  return dom
}

describe('autoFillForm across input types', () => {
  const PROFILE = {
    firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
    city: 'Boston', requireSponsorship: 'No',
    educationLevel: "Bachelor's Degree", gender: '',
  }

  it('fills text, select, radio, and consent checkbox; skips blank EEO and non-consent boxes', async () => {
    const dom = await bootForm(PROFILE)
    const doc = dom.window.document
    const filled = await dom.window.autoFillForm()

    expect(filled).toBeGreaterThan(0)
    expect(doc.getElementById('fn').value).toBe('Jane')
    expect(doc.getElementById('em').value).toBe('jane@example.com')
    expect(doc.getElementById('cy').value).toBe('Boston')
    expect(doc.getElementById('edu').value).toBe("Bachelor's Degree")

    const sponsorNo = doc.querySelector('input[name="visa_sponsorship"][value="No"]')
    const sponsorYes = doc.querySelector('input[name="visa_sponsorship"][value="Yes"]')
    expect(sponsorNo.checked).toBe(true)
    expect(sponsorYes.checked).toBe(false)

    expect(doc.querySelector('input[name="agree_terms"]').checked).toBe(true)
    expect(doc.querySelector('input[name="newsletter"]').checked).toBe(false)

    // gender profile value is blank → the field must be left empty
    expect(doc.getElementById('gd').value).toBe('')
    dom.window.close()
  })

  it('does not overwrite fields the user already filled', async () => {
    const dom = await bootForm(PROFILE)
    const doc = dom.window.document
    doc.getElementById('fn').value = 'Pre-existing'
    await dom.window.autoFillForm()
    expect(doc.getElementById('fn').value).toBe('Pre-existing')
    dom.window.close()
  })
})
