// Packages the standalone extension for the Chrome Web Store and Firefox AMO.
// Only runtime files ship: no server, tests, personal resumes, or node_modules.
//   node scripts/build-extension.mjs [chrome|firefox|all] [--zip]
import { cp, rm, mkdir, readdir, stat } from 'fs/promises'
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export const FILES = [
  'background.js', 'content_script.js', 'site_configs.js', 'h1b_data.json',
  'options.html', 'options.css', 'options.js',
  'offscreen.html', 'offscreen.js',
  'dashboard.html', 'dashboard.css', 'dashboard.js',
  'tex-engine.js', 'llm.js', 'store.js', 'bridge.js',
  'pipeline', 'templates', 'icons',
  'vendor/anthropic-sdk.js', 'vendor/swiftlatex', 'vendor/texlive',
  'LICENSE',
]

const MANIFESTS = { chrome: 'manifest.json', firefox: 'manifest_firefox.json' }

async function exists(p) {
  return stat(p).then(() => true, () => false)
}

async function build(target, zip) {
  const out = path.join(ROOT, 'dist', target)
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  for (const f of FILES) {
    const src = path.join(ROOT, f)
    if (!(await exists(src))) {
      console.warn(`  skip (missing): ${f}`)
      continue
    }
    await cp(src, path.join(out, f), { recursive: true })
  }
  await cp(path.join(ROOT, MANIFESTS[target]), path.join(out, 'manifest.json'))
  // Firefox's event-page background hosts the TeX worker itself.
  if (target === 'firefox') {
    await rm(path.join(out, 'offscreen.html'), { force: true })
    await rm(path.join(out, 'offscreen.js'), { force: true })
  }
  const count = (await readdir(out, { recursive: true })).length
  console.log(`Built dist/${target} (${count} entries)`)
  if (zip) {
    const zipPath = path.join(ROOT, 'dist', `hemline-${target}.zip`)
    await rm(zipPath, { force: true })
    execFileSync('zip', ['-qr', '-X', zipPath, '.'], { cwd: out })
    console.log(`  → dist/hemline-${target}.zip (${((await stat(zipPath)).size / 1e6).toFixed(1)} MB)`)
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const target = process.argv[2] ?? 'all'
  const zip = process.argv.includes('--zip')
  const targets = target === 'all' ? ['chrome', 'firefox'] : [target]
  for (const t of targets) await build(t, zip)
}
