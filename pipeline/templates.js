const LATEX_ESCAPES = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }

export function escapeLatex(text) {
  return String(text ?? '').replace(/[\\&%$#_{}~^]/g, ch => LATEX_ESCAPES[ch])
}

// hrefs keep the raw URL (hyperref handles it) but strip characters that would
// break out of the \href argument.
function safeUrl(url) {
  return String(url).replace(/[{}\\%#\s]/g, '')
}

function displayUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}

function withScheme(url) {
  return /^https?:\/\//.test(url) ? url : `https://${url}`
}

export function fullName(profile) {
  return [profile?.firstName, profile?.lastName].map(s => s?.trim()).filter(Boolean).join(' ')
}

export function contactLine(profile = {}) {
  const parts = []
  if (profile.phone?.trim()) parts.push(escapeLatex(profile.phone.trim()))
  if (profile.email?.trim()) {
    const email = safeUrl(profile.email.trim())
    parts.push(`\\href{mailto:${email}}{\\underline{${escapeLatex(email)}}}`)
  }
  for (const key of ['linkedin', 'github', 'website']) {
    const raw = profile[key]?.trim()
    if (!raw) continue
    const url = safeUrl(withScheme(raw))
    parts.push(`\\href{${url}}{\\underline{${escapeLatex(displayUrl(url))}}}`)
  }
  return parts.join(' $|$ ')
}

export function fillTemplate(tex, profile = {}) {
  return tex
    .replaceAll('{{NAME}}', escapeLatex(fullName(profile) || 'Your Name'))
    .replaceAll('{{CONTACT_LINE}}', contactLine(profile))
}
