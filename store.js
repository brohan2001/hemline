// Per-user state for the standalone extension. Small JSON (keys, profile, resume
// sources, ledger) lives in chrome.storage.local; generated PDFs live in IndexedDB
// because they are binary and can exceed storage.local's per-item comfort zone.

export const SETTINGS_KEYS = ['llmKeys', 'profile', 'resumeTex', 'projectPool', 'skillPools', 'clTemplate', 'backend', 'fastMode']

// Fast mode (low model reasoning) is on unless the user turned it off.
export const isFastMode = s => s?.fastMode !== false

export const PROFILE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'linkedin', 'github', 'website', 'skills', 'highlights',
  'city', 'state', 'stateAbbr', 'zip', 'country',
  'workAuthorization', 'requireSponsorship',
  'yearsExperience', 'startDate',
  'educationLevel', 'university', 'major', 'graduationYear', 'gpa',
  'salaryMin', 'salaryMax',
  'gender', 'race', 'veteranStatus',
]

// ─── Settings backup (Options → Export / Import settings) ────────────────────

// API keys stay out of exports so a shared backup never leaks them; imports
// still accept llmKeys for users who add them by hand.
export function buildSettingsBackup(s) {
  const backup = { hemline: 1 }
  if (s.profile && Object.keys(s.profile).length) backup.profile = s.profile
  for (const k of ['resumeTex', 'projectPool']) if (s[k]?.trim()) backup[k] = s[k]
  if (s.skillPools && Object.keys(s.skillPools).length) backup.skillPools = s.skillPools
  if (typeof s.fastMode === 'boolean') backup.fastMode = s.fastMode
  return backup
}

export function parseSettingsBackup(text, providers) {
  let data
  try { data = JSON.parse(text) } catch { throw new Error('Not a valid JSON file.') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object.')

  const out = {}
  if (data.profile !== undefined) {
    if (typeof data.profile !== 'object' || Array.isArray(data.profile)) throw new Error('"profile" must be an object.')
    out.profile = Object.fromEntries(PROFILE_FIELDS
      .map(f => [f, data.profile[f] == null ? '' : String(data.profile[f]).trim()])
      .filter(([, v]) => v))
  }
  if (data.resumeTex !== undefined) {
    if (typeof data.resumeTex !== 'string' || !data.resumeTex.includes('\\documentclass')) throw new Error('"resumeTex" must be a LaTeX document.')
    out.resumeTex = data.resumeTex
  }
  if (data.projectPool !== undefined) {
    if (typeof data.projectPool !== 'string') throw new Error('"projectPool" must be a string.')
    out.projectPool = data.projectPool
  }
  if (data.skillPools !== undefined) {
    const pools = typeof data.skillPools === 'string' ? { 'skills_pool.txt': data.skillPools } : data.skillPools
    if (!pools || typeof pools !== 'object' || Array.isArray(pools)) throw new Error('"skillPools" must be a string or an object.')
    out.skillPools = Object.fromEntries(Object.entries(pools).filter(([, v]) => typeof v === 'string' && v.trim()))
  }
  if (data.fastMode !== undefined) {
    if (typeof data.fastMode !== 'boolean') throw new Error('"fastMode" must be true or false.')
    out.fastMode = data.fastMode
  }
  if (data.llmKeys !== undefined) {
    if (!Array.isArray(data.llmKeys)) throw new Error('"llmKeys" must be an array.')
    out.llmKeys = data.llmKeys
      .filter(k => k && providers[k.provider] && typeof k.key === 'string' && k.key.trim())
      .map(k => ({ provider: k.provider, key: k.key.trim(), model: providers[k.provider].models.includes(k.model) ? k.model : providers[k.provider].models[0] }))
  }
  if (Object.keys(out).length === 0) throw new Error('Nothing to import: expected profile, resumeTex, projectPool, skillPools or llmKeys.')
  return out
}

export async function getSettings() {
  return chrome.storage.local.get(SETTINGS_KEYS)
}

// ─── Application ledger ──────────────────────────────────────────────────────

export function findDuplicates(entries, company, title, now = Date.now()) {
  const c = (company ?? '').trim().toLowerCase()
  const t = (title ?? '').trim().toLowerCase()
  if (!c) return { duplicate: false }
  const cutoff = now - 30 * 864e5
  const matches = entries.filter(e => {
    if ((e.company ?? '').trim().toLowerCase() !== c) return false
    if (t && (e.title ?? '').trim().toLowerCase() !== t) return false
    const ts = Date.parse(e.date)
    return !Number.isNaN(ts) && ts >= cutoff
  })
  if (matches.length === 0) return { duplicate: false }
  const latest = matches.reduce((a, b) => (a.date > b.date ? a : b))
  return { duplicate: true, lastDate: latest.date, lastTitle: latest.title, timesApplied: matches.length }
}

export async function readLedger() {
  const { ledger } = await chrome.storage.local.get('ledger')
  return Array.isArray(ledger) ? ledger : []
}

export async function appendLedger(entry) {
  const ledger = await readLedger()
  ledger.push({ date: new Date().toISOString().slice(0, 10), ...entry })
  await chrome.storage.local.set({ ledger })
}

export async function checkDuplicate(company, title) {
  return findDuplicates(await readLedger(), company, title)
}

// ─── PDF blobs (IndexedDB) ───────────────────────────────────────────────────

const DB_NAME = 'hemline'
const STORE = 'pdfs'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req?.result)
      t.onerror = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

export function savePdf(name, bytes) {
  return tx('readwrite', s => s.put(bytes, name))
}

export function loadPdf(name) {
  return tx('readonly', s => s.get(name))
}

// ─── Encoding helpers (runtime messages are JSON, so bytes travel as base64) ──

export function bytesToBase64(bytes) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
