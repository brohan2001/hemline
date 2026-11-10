// Copies the TeX files the bundled templates need from a local TeX Live install
// into vendor/texlive/pdftex/<kpse-format>/<name>, the layout the patched
// SwiftLaTeX engine fetches from. The list comes from runtime-manifest.txt, which
// was recorded by compiling the templates through scripts/texlive/serve.mjs.
import { readFile, mkdir, copyFile } from 'fs/promises'
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', '..', 'vendor', 'texlive', 'pdftex')
const EXT = { 3: '.tfm', 11: '.map', 26: '.tex', 32: '.pfb', 33: '.vf', 44: '.enc' }

export function locate(format, name) {
  const candidates = [name]
  if (!path.extname(name) && EXT[format]) candidates.unshift(name + EXT[format])
  for (const c of candidates) {
    try {
      const found = execFileSync('kpsewhich', ['-progname=pdflatex', c], { encoding: 'utf8' }).trim()
      if (found) return found
    } catch {}
  }
  return null
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const lines = (await readFile(path.join(HERE, 'runtime-manifest.txt'), 'utf8')).trim().split('\n')
  const missing = []
  for (const line of lines) {
    const [format, name] = line.split(' ')
    const src = locate(Number(format), name)
    if (!src) { missing.push(line); continue }
    await mkdir(path.join(OUT, format), { recursive: true })
    await copyFile(src, path.join(OUT, format, name))
  }
  console.log(`Copied ${lines.length - missing.length}/${lines.length} files into ${OUT}`)
  if (missing.length) {
    console.error(`Missing from local TeX Live:\n${missing.join('\n')}`)
    process.exit(1)
  }
}
