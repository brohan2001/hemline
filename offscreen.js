import { compileTex } from './tex-engine.js'
import { bytesToBase64 } from './store.js'

// Chrome MV3 service workers cannot spawn Workers, so the background hands LaTeX
// compiles to this offscreen document, which owns the WASM pdfTeX worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.op !== 'COMPILE_TEX') return
  compileTex(msg.tex)
    .then(({ pdf, log }) => sendResponse({ ok: true, pdf: bytesToBase64(pdf), log }))
    .catch(err => sendResponse({ ok: false, error: err.message, log: err.log ?? '' }))
  return true
})
