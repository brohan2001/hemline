// Escapes special characters the LLM commonly leaves bare, without touching
// legitimate LaTeX: the preamble is skipped entirely (macro definitions use &
// as real alignment tabs), comments stay comments, and URLs inside \href/\url
// keep their underscores.
export function sanitizeLatex(tex) {
  const MARKER = '\\begin{document}'
  const bodyStart = tex.indexOf(MARKER)
  if (bodyStart === -1) return { tex, fixes: 0 }
  const preamble = tex.slice(0, bodyStart + MARKER.length)
  const body = tex.slice(bodyStart + MARKER.length)

  let fixes = 0
  const lines = body.split('\n').map(line => {
    if (/^\s*%/.test(line)) return line

    const protectedSpans = []
    for (const m of line.matchAll(/\\(?:href|url)\{[^}]*\}/g)) {
      protectedSpans.push([m.index, m.index + m[0].length])
    }
    const isProtected = i => protectedSpans.some(([s, e]) => i >= s && i < e)

    let out = ''
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      const prev = line[i - 1]
      if (prev === '\\' || isProtected(i)) { out += ch; continue }
      if (ch === '&') { out += '\\&'; fixes++; continue }
      if (ch === '_') { out += '\\_'; fixes++; continue }
      if (ch === '%' && /[\w}]/.test(prev ?? '')) { out += '\\%'; fixes++; continue }
      if (ch === '%') { out += line.slice(i); break }
      out += ch
    }
    return out
  })
  return { tex: preamble + lines.join('\n'), fixes }
}
