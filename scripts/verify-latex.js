import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import { sanitizeLatex } from '../pipeline/sanitize.js'

export { sanitizeLatex }

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/verify-latex.js <file.tex>')
    process.exit(1)
  }
  const original = await fs.readFile(file, 'utf8')
  const { tex, fixes } = sanitizeLatex(original)
  if (fixes > 0) {
    await fs.writeFile(file, tex, 'utf8')
    console.log(`[Sanitizer] Fixed ${fixes} issues in ${file}`)
  } else {
    console.log('[Sanitizer] OK')
  }
}
