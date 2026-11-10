// Rebuilds the bundled pdfTeX format (vendor/texlive/pdftex/10/swiftlatexpdftex.fmt)
// and re-records which TeX files the templates need. The SwiftLaTeX engine can
// only build its format from inside a browser, so:
//   1. node scripts/texlive/serve.mjs        (needs a local TeX Live: kpsewhich)
//   2. open http://localhost:8765/ and click "Build format", then "Compile templates"
//   3. node scripts/texlive/serve.mjs --manifest   → rewrites runtime-manifest.txt
//   4. npm run build:texmf
import http from 'http'
import { readFile, writeFile, appendFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { locate } from './build-texmf.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const FMT = path.join(ROOT, 'vendor', 'texlive', 'pdftex', '10', 'swiftlatexpdftex.fmt')
const LOG = path.join(HERE, 'requests.log')

if (process.argv.includes('--manifest')) {
  const lines = (await readFile(LOG, 'utf8')).trim().split('\n')
  const wanted = new Set(lines.filter(l => l.startsWith('200 ') && !l.startsWith('200 10 ')).map(l => l.split(' ').slice(1, 3).join(' ')))
  await writeFile(path.join(HERE, 'runtime-manifest.txt'), [...wanted].sort().join('\n') + '\n')
  console.log(`runtime-manifest.txt: ${wanted.size} files`)
  process.exit(0)
}

const STATIC = {
  '/': [path.join(HERE, 'format.html'), 'text/html'],
  '/swiftlatexpdftex.js': [path.join(ROOT, 'vendor', 'swiftlatex', 'swiftlatexpdftex.js'), 'text/javascript'],
  '/swiftlatexpdftex.wasm': [path.join(ROOT, 'vendor', 'swiftlatex', 'swiftlatexpdftex.wasm'), 'application/wasm'],
  '/resume_template.tex': [path.join(ROOT, 'templates', 'resume_template.tex'), 'text/plain'],
  '/cover_letter_template.tex': [path.join(ROOT, 'templates', 'cover_letter_template.tex'), 'text/plain'],
}

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (req.method === 'POST' && url === '/savefmt') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    await writeFile(FMT, Buffer.concat(chunks))
    res.writeHead(200)
    return res.end('ok')
  }
  if (req.method === 'POST' && url === '/resetlog') {
    await writeFile(LOG, '')
    res.writeHead(200)
    return res.end('ok')
  }
  const m = url.match(/^\/texlive\/pdftex\/(\d+)\/(.+)$/)
  if (m) {
    const [, fmt, name] = m
    const found = fmt === '10' ? FMT
      : name === 'language.dat' ? path.join(HERE, 'language.dat')
        : locate(Number(fmt), name)
    await appendFile(LOG, `${found ? 200 : 404} ${fmt} ${name}\n`)
    if (!found) { res.writeHead(301); return res.end() }
    try {
      const body = await readFile(found)
      res.writeHead(200, { fileid: fmt === '26' ? name : `${fmt}_${name}` })
      return res.end(body)
    } catch {
      res.writeHead(301)
      return res.end()
    }
  }
  const entry = STATIC[url]
  if (!entry) { res.writeHead(404); return res.end() }
  const body = await readFile(entry[0])
  res.writeHead(200, { 'Content-Type': entry[1] })
  res.end(body)
}).listen(8765, () => console.log('Format builder on http://localhost:8765/'))
