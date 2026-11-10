import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { JSDOM } from 'jsdom'
import { chromeMock } from './helpers/chrome-mock.js'

const siteConfigsCode = readFileSync(new URL('../site_configs.js', import.meta.url), 'utf8')
const contentScriptCode = readFileSync(new URL('../content_script.js', import.meta.url), 'utf8')

// Shape of a live Ashby application tab (Nov 2026): no <form>, labels sit in a
// field-entry container instead of label[for], and an "autofill from resume"
// upload sits above the real Resume field.
const ASHBY_HTML = `<!DOCTYPE html><html><head><title>Applied AI Engineer @ Twenty</title></head><body>
  <div id="root"><div class="ashby-job-posting-right-pane"><div id="form">
    <div class="_autofillPane ashby-application-form-autofill-pane"><input type="file"></div>
    <div class="_fieldEntry ashby-application-form-field-entry"><label>Email</label><input id="_systemfield_email" name="_systemfield_email" type="email"></div>
    <div class="_fieldEntry ashby-application-form-field-entry"><label>Resume</label><input id="_systemfield_resume" type="file"></div>
    <div class="_fieldEntry ashby-application-form-field-entry"><label>Cover Letter</label><input id="77ca3618" type="file"></div>
    <button>Submit Application</button>
  </div></div></div>
</body></html>`

async function boot(storage) {
  const dom = new JSDOM(ASHBY_HTML, { url: 'https://jobs.ashbyhq.com/twenty/490ea911/application', runScripts: 'outside-only' })
  const w = dom.window
  w.chrome = chromeMock({ profile: { firstName: 'Alex', lastName: 'Chen', email: 'alex@example.com' }, ...storage }, {
    GET_PDF: ({ name }) => Buffer.from(`%PDF-${name}`).toString('base64'),
    STATUS: { backend: 'extension', hasKey: true, hasResume: true },
  })
  // JSDOM has neither DataTransfer nor a writable input.files.
  w.DataTransfer = class { constructor() { this.list = []; this.items = { add: f => this.list.push(f) } } get files() { return this.list } }
  Object.defineProperty(w.HTMLInputElement.prototype, 'files', { configurable: true, get() { return this._files ?? [] }, set(v) { this._files = v } })
  w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) })
  w.alert = () => {}
  w.eval(siteConfigsCode)
  w.eval(contentScriptCode)
  for (let i = 0; i < 30 && !w.document.getElementById('hemline-autofill-btn'); i++) await new Promise(r => setTimeout(r, 10))
  return dom
}

const names = (doc, sel) => [...doc.querySelector(sel).files].map(f => f.name)

describe('Auto-Fill on Ashby', () => {
  it('shows the Auto-Fill button even though the page has no <form>', async () => {
    const dom = await boot({})
    expect(dom.window.document.getElementById('hemline-autofill-btn')).not.toBeNull()
    dom.window.close()
  })

  it('attaches resume and matching cover letter to the right slots, not the autofill parser', async () => {
    const dom = await boot({ coverLetterMeta: { company: 'Twenty', at: Date.now() } })
    const doc = dom.window.document
    await dom.window.autoFillForm()
    expect(doc.getElementById('_systemfield_email').value).toBe('alex@example.com')
    expect(names(doc, '#_systemfield_resume')).toEqual(['Alex_Chen_Resume.pdf'])
    expect(names(doc, '[id="77ca3618"]')).toEqual(['Alex_Chen_Cover_Letter.pdf'])
    expect(names(doc, '.ashby-application-form-autofill-pane input')).toEqual([])
    dom.window.close()
  })

  it('does not attach a cover letter written for another company', async () => {
    const dom = await boot({ coverLetterMeta: { company: 'Pendo', at: Date.now() } })
    const doc = dom.window.document
    await dom.window.autoFillForm()
    expect(names(doc, '#_systemfield_resume')).toEqual(['Alex_Chen_Resume.pdf'])
    expect(names(doc, '[id="77ca3618"]')).toEqual([])
    dom.window.close()
  })
})
