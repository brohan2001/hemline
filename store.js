// Per-user state for the standalone extension. Small JSON (keys, profile, resume
// sources, ledger) lives in chrome.storage.local; generated PDFs live in IndexedDB
// because they are binary and can exceed storage.local's per-item comfort zone.

export const SETTINGS_KEYS = ['llmKeys', 'profile', 'resumeTex', 'projectPool', 'skillPools', 'clTemplate', 'backend']

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

const DB_NAME = 'jseek'
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
