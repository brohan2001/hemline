import { parseSkillRows, validateRows } from './validate-skills.js'

// Validates the LLM's Technical Skills block against the prompt's hard
// constraints (5 rows, 60-105 visible chars for rows 1-4, 150-200 for Courses).
export function validateLlmSkills(rawTex) {
  const start = rawTex.indexOf('\\section{Technical Skills}')
  if (start === -1) return { passed: false, violations: [{ reason: 'Technical Skills section missing' }] }
  const end = rawTex.indexOf('\\section{', start + 1)
  return validateRows(parseSkillRows(rawTex.slice(start, end === -1 ? rawTex.length : end)))
}

export function extractSkillsSection(tex) {
  const lines = tex.split('\n')
  const start = lines.findIndex(l => l.includes('Technical Skills'))
  if (start === -1) return '  (Technical Skills section not found in file)'
  const end = lines.findIndex((l, i) => i > start && l.trimStart().startsWith('\\section{'))
  return lines.slice(start, end === -1 ? start + 40 : end).join('\n')
}

// Strips any preamble text the LLM may emit before \documentclass and after \end{document}.
export function extractLatex(output) {
  const start = output.indexOf('\\documentclass')
  const end = output.lastIndexOf('\\end{document}')
  if (start === -1 || end === -1) return null
  return output.slice(start, end + '\\end{document}'.length)
}

// Tailor output is either a full document or just the Skills/Projects sections.
export function extractTailorOutput(output) {
  const full = extractLatex(output)
  if (full) return full
  const start = output.indexOf('\\section{Technical Skills}')
  return start === -1 ? null : output.slice(start)
}

// Escapes any bare & in the Technical Skills section body that the LLM forgot to escape.
export function sanitizeSkillsAmpersands(tex) {
  const start = tex.indexOf('\\section{Technical Skills}')
  if (start === -1) return tex
  const end = tex.indexOf('\\section{', start + 1)
  const boundary = end === -1 ? tex.length : end
  const skillsChunk = tex.slice(start, boundary).replace(/(?<!\\)&/g, '\\&')
  return tex.slice(0, start) + skillsChunk + tex.slice(boundary)
}

// Used by /cover-letter: grafts the template preamble onto the LLM-generated body.
export function graftPreamble(original, llmOutput) {
  const MARKER = '\\begin{document}'
  const origIdx = original.indexOf(MARKER)
  const llmIdx = llmOutput.indexOf(MARKER)
  if (origIdx === -1 || llmIdx === -1) return llmOutput
  return original.slice(0, origIdx + MARKER.length) + llmOutput.slice(llmIdx + MARKER.length)
}

// Used by /tailor: surgically replaces only the named \section{...} block from
// llmOutput into the original document, leaving everything else untouched so the
// LLM can never corrupt \resumeItemListEnd or other custom commands in the body.
// Blocks end at the next \section or \end{document}, so llmOutput may be either a
// full document or just the requested sections.
function sectionBounds(tex, tag) {
  const start = tex.indexOf(tag)
  if (start === -1) return null
  const ends = [tex.indexOf('\\section{', start + 1), tex.indexOf('\\end{document}', start)]
    .filter(i => i !== -1)
  return [start, ends.length ? Math.min(...ends) : tex.length]
}

export function graftSection(original, llmOutput, sectionName) {
  const TAG = `\\section{${sectionName}}`
  const llm = sectionBounds(llmOutput, TAG)
  const orig = sectionBounds(original, TAG)
  if (!llm || !orig) return original
  const llmBlock = llmOutput.slice(llm[0], llm[1]).replace(/\n*`{3}\s*$/, '').trimEnd() + '\n\n'
  return original.slice(0, orig[0]) + llmBlock + original.slice(orig[1])
}

export const graftSkillsSection   = (original, llmOutput) => graftSection(original, llmOutput, 'Technical Skills')
export const graftProjectsSection = (original, llmOutput) => graftSection(original, llmOutput, 'Projects')

// Pulls the first "! <error>" line (and its l.<num> location) out of pdflatex
// output so 500 responses can say what actually broke instead of "Command failed".
export function extractLatexError(stdout) {
  const lines = (stdout ?? '').split('\n')
  const idx = lines.findIndex(l => l.startsWith('! '))
  if (idx === -1) return null
  const context = lines.slice(idx, idx + 4).filter(Boolean)
  const lineRef = context.find(l => /^l\.\d+/.test(l))
  return {
    message: lines[idx].slice(2),
    line: lineRef ? parseInt(lineRef.slice(2)) : null,
    excerpt: context.join('\n'),
  }
}

// Reads the page count pdflatex reports, e.g. "Output written on swe.pdf (1 page, ...)".
// pdflatex hard-wraps its terminal output at 79 columns, so long paths split this
// line; match across newlines or the page guard silently never fires.
export function parsePageCount(stdout) {
  const m = (stdout ?? '').match(/Output written on [\s\S]*?\((\d+)\s+pages?/)
  return m ? parseInt(m[1], 10) : null
}

// Tightens vertical spacing so an overflowing resume collapses back to 1 page:
// pulls the top margin up 0.05in and extends the text height 0.1in per pass.
export function tightenVerticalSpacing(tex) {
  return tex
    .replace(/\\addtolength\{\\topmargin\}\{(-?[\d.]+)in\}/, (_, v) =>
      `\\addtolength{\\topmargin}{${(parseFloat(v) - 0.05).toFixed(2)}in}`)
    .replace(/\\addtolength\{\\textheight\}\{(-?[\d.]+)in\}/, (_, v) =>
      `\\addtolength{\\textheight}{${(parseFloat(v) + 0.1).toFixed(2)}in}`)
}

export function sanitizeFilename(name) {
  return (name ?? '').replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Company'
}

// Trims text to maxLen chars without cutting a word mid-token.
export function trimToWord(text, maxLen) {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(' ', maxLen)
  return cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)
}

export function trimToItem(text, maxLen) {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(',', maxLen)
  return cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)
}

// Estimates the visible PDF character count of a LaTeX skills line.
export function visibleLength(latexLine) {
  return latexLine
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\item\s*/g, '')
    .replace(/\\\\$/, '')
    .replace(/\\&/g, '&')
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .length
}

// Clamps skill rows 2–4 to ≤105 visible chars to prevent PDF margin overflow.
export function applySkillsLineTrimmer(tex, maxVisible = 105) {
  const start = tex.indexOf('\\section{Technical Skills}')
  if (start === -1) return tex
  const end = tex.indexOf('\\section{', start + 1)
  const boundary = end === -1 ? tex.length : end
  const lines = tex.slice(start, boundary).split('\n')
  let contentRow = 0
  const trimmed = lines.map(line => {
    if (!line.includes('\\textbf{')) return line
    contentRow++
    if (contentRow < 2) return line
    const limit = contentRow <= 4 ? maxVisible : 200
    if (visibleLength(line) <= limit) return line
    const m = line.match(/^(.*?\\textbf\{[^}]+\}\{)(.*?)(\}\s*(?:\\\\)?)\s*$/)
    let result
    if (!m) {
      result = trimToItem(line, line.length - (visibleLength(line) - limit))
    } else {
      const trimmedBody = trimToItem(m[2], limit - visibleLength(m[1])).replace(/,\s*$/, '')
      result = m[1] + trimmedBody + m[3]
    }
    return result
  })
  return tex.slice(0, start) + trimmed.join('\n') + tex.slice(boundary)
}
