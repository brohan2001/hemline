// Port client for extension pages (options, dashboard). Content scripts carry an
// inline copy because they cannot import modules.
let port = null
let seq = 0
const pending = new Map()

function getPort() {
  if (port) return port
  port = chrome.runtime.connect({ name: 'hemline' })
  port.onMessage.addListener((msg) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) return p.resolve(msg.result)
    const err = new Error(msg.error)
    err.latexError = msg.latexError
    p.reject(err)
  })
  port.onDisconnect.addListener(() => {
    port = null
    for (const p of pending.values()) p.reject(new Error('Hemline background restarted; please retry.'))
    pending.clear()
  })
  return port
}

export function callBackground(op, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const p = getPort()
    const keepAlive = setInterval(() => { try { p.postMessage({ ping: true }) } catch {} }, 20_000)
    pending.set(id, {
      resolve: (v) => { clearInterval(keepAlive); resolve(v) },
      reject: (e) => { clearInterval(keepAlive); reject(e) },
    })
    p.postMessage({ id, op, payload })
  })
}

export function base64ToBlobUrl(b64, type = 'application/pdf') {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type }))
}
