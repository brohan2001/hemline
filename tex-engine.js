// Thin wrapper over the vendored SwiftLaTeX pdfTeX worker. Runs anywhere a
// dedicated Worker is available: the Chrome offscreen document, or Firefox's
// event-page background. All TeX inputs (format, classes, fonts) are served from
// the bundled vendor/texlive tree, so nothing is fetched from the network.

const ENGINE_URL = new URL('./vendor/swiftlatex/swiftlatexpdftex.js', import.meta.url)
const TEXLIVE_URL = new URL('./vendor/texlive/', import.meta.url).href

let worker = null
let ready = null
let queue = Promise.resolve()

function nextMessage(predicate) {
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      if (!predicate(ev.data)) return
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      resolve(ev.data)
    }
    const onError = (ev) => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      reject(new Error(`TeX engine crashed: ${ev.message ?? 'unknown error'}`))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
  })
}

function start() {
  if (ready) return ready
  worker = new Worker(ENGINE_URL)
  ready = nextMessage(d => d.result && !d.cmd).then(d => {
    if (d.result !== 'ok') throw new Error('TeX engine failed to initialise')
    worker.postMessage({ cmd: 'settexliveurl', url: TEXLIVE_URL })
  }).catch(err => {
    worker?.terminate()
    worker = null
    ready = null
    throw err
  })
  return ready
}

async function compileNow(tex) {
  await start()
  const written = nextMessage(d => d.cmd === 'writefile')
  worker.postMessage({ cmd: 'writefile', url: 'main.tex', src: tex })
  if ((await written).result !== 'ok') throw new Error('Could not write main.tex into the TeX engine')
  worker.postMessage({ cmd: 'setmainfile', url: 'main.tex' })
  const done = nextMessage(d => d.cmd === 'compile')
  worker.postMessage({ cmd: 'compilelatex' })
  const result = await done
  if (result.result !== 'ok') {
    const err = new Error(`LaTeX compile failed (status ${result.status})`)
    err.log = result.log
    throw err
  }
  return { pdf: new Uint8Array(result.pdf), log: result.log }
}

// The engine keeps one in-memory filesystem, so compiles must not overlap.
export function compileTex(tex) {
  const run = queue.then(() => compileNow(tex))
  queue = run.catch(() => {})
  return run
}
