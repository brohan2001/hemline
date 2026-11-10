import { PROVIDERS } from './llm.js'
import { callBackground, base64ToBlobUrl } from './bridge.js'
import { PROFILE_FIELDS, SETTINGS_KEYS, buildSettingsBackup, parseSettingsBackup, isFastMode } from './store.js'

const FIELDS = PROFILE_FIELDS
const SKILL_POOL_NAME = 'skills_pool.txt'

const $ = (id) => document.getElementById(id)
let keys = []
let previewUrl = null

function flash(el, text, isError = false) {
  el.textContent = text
  el.classList.toggle('error', isError)
  if (!isError) setTimeout(() => { if (el.textContent === text) el.textContent = '' }, 2500)
}

function describeLatexError(err) {
  return err.latexError ? `${err.message} (LaTeX: ${err.latexError.message}${err.latexError.line ? `, line ${err.latexError.line}` : ''})` : err.message
}

// ─── Checklist ───────────────────────────────────────────────────────────────

async function refreshChecklist() {
  const { llmKeys, resumeTex, profile } = await chrome.storage.local.get(['llmKeys', 'resumeTex', 'profile'])
  const done = {
    key: (llmKeys ?? []).some(k => k.key?.trim()),
    resume: Boolean(resumeTex?.trim()),
    profile: Boolean(profile?.firstName && profile?.email),
  }
  for (const li of document.querySelectorAll('#checklist li')) li.classList.toggle('done', done[li.dataset.step])
}

// ─── API keys ────────────────────────────────────────────────────────────────

function saveKeys() {
  return chrome.storage.local.set({ llmKeys: keys }).then(refreshChecklist)
}

function option(value, label, selected) {
  const o = document.createElement('option')
  o.value = value
  o.textContent = label
  o.selected = selected
  return o
}

function renderKeys() {
  const list = $('key-list')
  list.replaceChildren()
  keys.forEach((entry, i) => {
    const row = document.createElement('div')
    row.className = 'key-row'

    const provider = document.createElement('select')
    for (const [id, p] of Object.entries(PROVIDERS)) provider.append(option(id, `${p.label}${p.free ? ' (free tier)' : ''}`, id === entry.provider))
    provider.addEventListener('change', () => {
      entry.provider = provider.value
      entry.model = PROVIDERS[provider.value].models[0]
      saveKeys().then(renderKeys)
    })

    const key = document.createElement('input')
    key.type = 'password'
    key.placeholder = 'Paste API key'
    key.value = entry.key ?? ''
    key.autocomplete = 'off'
    key.addEventListener('change', () => { entry.key = key.value.trim(); saveKeys() })

    const model = document.createElement('select')
    for (const m of PROVIDERS[entry.provider].models) model.append(option(m, m, m === entry.model))
    model.addEventListener('change', () => { entry.model = model.value; saveKeys() })

    const controls = document.createElement('div')
    controls.className = 'controls'
    const result = document.createElement('div')
    result.className = 'result status'
    const test = Object.assign(document.createElement('button'), { className: 'icon', textContent: 'Test', title: 'Send a tiny test request' })
    test.addEventListener('click', async () => {
      entry.key = key.value.trim()
      await saveKeys()
      test.disabled = true
      flash(result, 'Testing…')
      try {
        await callBackground('TEST_KEY', { entry })
        flash(result, `${PROVIDERS[entry.provider].label} key works ✓`)
      } catch (err) {
        flash(result, err.message, true)
      } finally {
        test.disabled = false
      }
    })
    const up = Object.assign(document.createElement('button'), { className: 'icon', textContent: '↑', title: 'Try this key earlier' })
    up.disabled = i === 0
    up.addEventListener('click', () => { [keys[i - 1], keys[i]] = [keys[i], keys[i - 1]]; saveKeys().then(renderKeys) })
    const remove = Object.assign(document.createElement('button'), { className: 'icon', textContent: '✕', title: 'Remove key' })
    remove.addEventListener('click', () => { keys.splice(i, 1); saveKeys().then(renderKeys) })
    controls.append(test, up, remove)

    row.append(provider, key, model, controls, result)
    list.append(row)
  })
}

function renderKeyLinks() {
  const span = $('key-links')
  span.replaceChildren('Get a key: ')
  Object.values(PROVIDERS).forEach((p, i) => {
    const a = Object.assign(document.createElement('a'), { href: p.keyUrl, textContent: p.label, target: '_blank', rel: 'noopener' })
    span.append(a)
    if (i < Object.keys(PROVIDERS).length - 1) span.append(' · ')
  })
}

$('fast-mode').addEventListener('change', (e) => chrome.storage.local.set({ fastMode: e.target.checked }))

$('add-key').addEventListener('click', () => {
  const provider = keys.length === 0 ? 'gemini' : 'anthropic'
  keys.push({ provider, key: '', model: PROVIDERS[provider].models[0] })
  saveKeys().then(renderKeys)
})

// ─── Resume ──────────────────────────────────────────────────────────────────

function showTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name)
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab))

function showPdf(b64) {
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = base64ToBlobUrl(b64)
  $('pdf-preview').src = previewUrl
  $('pdf-preview').hidden = false
}

$('convert').addEventListener('click', async () => {
  const text = $('resume-text').value.trim()
  if (!text) return flash($('convert-status'), 'Paste your resume text first.', true)
  await saveProfile(false)
  $('convert').disabled = true
  flash($('convert-status'), 'Converting with your AI key… (20-60 s)')
  try {
    const { tex, pdf, pages } = await callBackground('IMPORT_RESUME', { text })
    $('resume-tex').value = tex
    showTab('tex')
    showPdf(pdf)
    flash($('resume-status'), pages > 1 ? `Converted, but it runs ${pages} pages. Trim it, then Save.` : 'Converted. Review the preview, edit if needed, then Save.', pages > 1)
    $('convert-status').textContent = ''
  } catch (err) {
    flash($('convert-status'), describeLatexError(err), true)
  } finally {
    $('convert').disabled = false
  }
})

$('tex-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (file) $('resume-tex').value = await file.text()
})

async function compilePreview() {
  const tex = $('resume-tex').value
  if (!tex.includes('\\documentclass')) throw new Error('That does not look like a LaTeX document (no \\documentclass).')
  const { pdf, pages } = await callBackground('PREVIEW_TEX', { tex })
  showPdf(pdf)
  return pages
}

$('preview').addEventListener('click', async () => {
  $('preview').disabled = true
  flash($('resume-status'), 'Compiling…')
  try {
    const pages = await compilePreview()
    flash($('resume-status'), pages > 1 ? `Compiles, but it is ${pages} pages.` : 'Compiles to 1 page ✓', pages > 1)
  } catch (err) {
    flash($('resume-status'), describeLatexError(err), true)
  } finally {
    $('preview').disabled = false
  }
})

$('save-resume').addEventListener('click', async () => {
  const tex = $('resume-tex').value
  const missing = ['\\section{Technical Skills}', '\\section{Projects}'].filter(s => !tex.includes(s))
  if (missing.length) return flash($('resume-status'), `Tailoring needs these sections: ${missing.join(', ')}`, true)
  $('save-resume').disabled = true
  try {
    await compilePreview()
    await chrome.storage.local.set({ resumeTex: tex })
    await refreshChecklist()
    flash($('resume-status'), 'Resume saved ✓')
  } catch (err) {
    flash($('resume-status'), `Not saved: ${describeLatexError(err)}`, true)
  } finally {
    $('save-resume').disabled = false
  }
})

$('save-pools').addEventListener('click', async () => {
  const pool = $('skill-pool').value.trim()
  await chrome.storage.local.set({
    projectPool: $('project-pool').value,
    skillPools: pool ? { [SKILL_POOL_NAME]: pool } : {},
  })
  flash($('pools-status'), 'Saved ✓')
})

$('load-sample-pool').addEventListener('click', async () => {
  const sample = await (await fetch(chrome.runtime.getURL('templates/project_pool_sample.tex'))).text()
  $('project-pool').value = ($('project-pool').value.trim() ? `${$('project-pool').value.trim()}\n\n` : '') + sample
})

// ─── Profile ─────────────────────────────────────────────────────────────────

async function saveProfile(showStatus = true) {
  const entries = FIELDS
    .map(f => [f, $(f)?.value.trim() ?? ''])
    .filter(([, v]) => v)
  await chrome.storage.local.set({ profile: Object.fromEntries(entries) })
  await refreshChecklist()
  if (showStatus) flash($('status'), 'Saved ✓')
}
$('save').addEventListener('click', () => saveProfile())

// ─── Advanced ────────────────────────────────────────────────────────────────

$('universal').addEventListener('change', async (e) => {
  const origins = ['*://*/*']
  if (e.target.checked) {
    e.target.checked = await chrome.permissions.request({ origins })
  } else {
    await chrome.permissions.remove({ origins })
  }
})

$('backend').addEventListener('change', async (e) => {
  if (e.target.value === 'local') {
    const ok = await chrome.permissions.request({ origins: ['http://localhost:4567/*'] })
    if (!ok) { e.target.value = 'extension'; return }
  }
  await chrome.storage.local.set({ backend: e.target.value })
})

$('export-ledger').addEventListener('click', async () => download('hemline-applications.json', await callBackground('GET_LEDGER')))

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

$('export-settings').addEventListener('click', async () => {
  download('hemline-settings.json', buildSettingsBackup(await chrome.storage.local.get(SETTINGS_KEYS)))
  flash($('backup-status'), 'Exported (API keys are not included)')
})

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    const data = parseSettingsBackup(await file.text(), PROVIDERS)
    await chrome.storage.local.set(data)
    await init()
    flash($('backup-status'), `Imported ${Object.keys(data).join(', ')} ✓`)
  } catch (err) {
    flash($('backup-status'), `Import failed: ${err.message}`, true)
  }
})

// ─── Boot ────────────────────────────────────────────────────────────────────

async function init() {
  const s = await chrome.storage.local.get(['llmKeys', 'profile', 'resumeTex', 'projectPool', 'skillPools', 'backend', 'ledger', 'fastMode'])
  keys = s.llmKeys ?? []
  if (keys.length === 0) keys.push({ provider: 'gemini', key: '', model: PROVIDERS.gemini.models[0] })
  renderKeys()
  renderKeyLinks()
  $('fast-mode').checked = isFastMode(s)

  FIELDS.forEach(f => { if ($(f)) $(f).value = s.profile?.[f] ?? '' })
  if (s.resumeTex) {
    $('resume-tex').value = s.resumeTex
    showTab('tex')
  }
  $('project-pool').value = s.projectPool ?? ''
  $('skill-pool').value = s.skillPools?.[SKILL_POOL_NAME] ?? Object.values(s.skillPools ?? {}).join('\n')
  $('backend').value = s.backend ?? 'extension'
  $('universal').checked = await chrome.permissions.contains({ origins: ['*://*/*'] })
  $('ledger-count').textContent = `${(s.ledger ?? []).length} applications logged`
  await refreshChecklist()
}

init()
