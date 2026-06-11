// Shared Technical Skills constraint validation, used by server.js (LLM retry
// gate) and scripts/benchmark-models.js (report generation).

export function extractSkillsBlock(latex) {
  const start = latex.indexOf('\\section{Technical Skills}')
  if (start === -1) return null
  const end = latex.indexOf('\\end{itemize}', start)
  if (end === -1) return null
  return latex.slice(start, end + '\\end{itemize}'.length)
}

export function stripMarkup(line) {
  return line
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\&/g, '&')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSkillRows(block) {
  const rows = []
  let pos = 0

  while (true) {
    const tbStart = block.indexOf('\\textbf{', pos)
    if (tbStart === -1) break

    const headingClose = block.indexOf('}', tbStart + 8)
    if (headingClose === -1) break
    const heading = stripMarkup(block.slice(tbStart + 8, headingClose))

    const contentOpen = block.indexOf('{:', headingClose)
    if (contentOpen === -1) break

    let depth = 1
    let i = contentOpen + 1
    while (i < block.length && depth > 0) {
      if (block[i] === '{') depth++
      else if (block[i] === '}') depth--
      i++
    }
    const contentClose = i - 1

    const rawContent = block.slice(contentOpen + 2, contentClose).trim()
    const parts = rawContent.split(/\\\\/).map(s => s.trim()).filter(Boolean)

    const physicalLines = parts.map((part, idx) => {
      const fullLine = idx === 0 ? `${heading}: ${part}` : part
      const stripped = stripMarkup(fullLine)
      return { raw: fullLine, stripped, length: stripped.length }
    })

    rows.push({ heading, physicalLines })
    pos = contentClose + 1
  }

  return rows
}

export function validateRows(rows) {
  const row1IsLanguages = rows.length >= 1 && rows[0].heading === 'Languages'
  const row5IsCourses   = rows.length >= 5 && rows[4].heading === 'Courses'
  const row5IsOneLine   = rows.length >= 5 && rows[4].physicalLines.length === 1

  const violations = []
  const lines = []

  rows.forEach((row, ri) => {
    const isCourses = ri === 4
    row.physicalLines.forEach((pl, li) => {
      const len = pl.length
      const pass = isCourses
        ? (len >= 150 && len <= 200)
        : (len >= 60  && len <= 105)
      if (!pass) violations.push({ rowIndex: ri + 1, lineIndex: li + 1, heading: row.heading, length: len, isCourses })
      lines.push({ rowIndex: ri + 1, lineIndex: li + 1, heading: row.heading, stripped: pl.stripped, length: len, isCourses, pass })
    })
  })

  const allLinesPassed = lines.length > 0 && lines.every(l => l.pass)

  return {
    row1IsLanguages,
    row5IsCourses,
    row5IsOneLine,
    lines,
    violations,
    allLinesPassed,
    passed: row1IsLanguages && row5IsCourses && row5IsOneLine && allLinesPassed,
  }
}
