export const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'will', 'this', 'that', 'have', 'has',
  'from', 'who', 'what', 'when', 'where', 'how', 'all', 'can', 'not', 'but', 'their', 'they',
  'work', 'working', 'team', 'teams', 'role', 'job', 'years', 'year', 'experience', 'experienced',
  'skills', 'skill', 'ability', 'strong', 'plus', 'must', 'required', 'requirements', 'preferred',
  'qualifications', 'responsibilities', 'about', 'more', 'other', 'such', 'including', 'across',
  'within', 'using', 'use', 'used', 'new', 'help', 'build', 'building', 'develop', 'developing',
  'development', 'engineer', 'engineering', 'engineers', 'software', 'looking', 'join', 'company',
  'candidates', 'candidate', 'position', 'opportunity', 'benefits', 'salary', 'location', 'remote',
  'employment', 'equal', 'status', 'per', 'etc', 'related', 'degree', 'bachelor', 'master',
])

// Scores how many of the JD's top keywords appear in the final tailored tex.
export function computeMatchScore(jd, tex) {
  const freq = {}
  for (const w of jd.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) ?? []) {
    if (!STOPWORDS.has(w)) freq[w] = (freq[w] ?? 0) + 1
  }
  const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w]) => w)
  if (keywords.length === 0) return { score: 0, matched: [], missing: [] }
  const haystack = tex.toLowerCase()
  const matched = keywords.filter(k => haystack.includes(k))
  return {
    score: Math.round((matched.length / keywords.length) * 100),
    matched,
    missing: keywords.filter(k => !matched.includes(k)),
  }
}
