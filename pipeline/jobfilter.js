// ─── USA-only location filter ────────────────────────────────────────────────
// Explicit US city/state names. 'us'/'usa'/'united states' and state abbreviations
// are matched separately by regex (word-bounded) to avoid substring false positives.
const USA_TOKENS = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
  'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
  'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
  'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
  'wisconsin', 'wyoming', 'd.c.', 'washington dc',
  'san francisco', 'new york city', 'nyc', 'seattle', 'austin', 'boston', 'denver',
  'chicago', 'los angeles', 'atlanta', 'mountain view', 'palo alto', 'menlo park',
  'sunnyvale', 'san jose', 'bellevue', 'redmond', 'cupertino', 'santa clara']

const US_STATE_ABBR = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/
const US_WORD = /\b(us|usa|u\.s\.?|united states)\b/i

// Foreign country / city markers. Deliberately excludes terms that collide with US
// places (e.g. "georgia" the country vs. Atlanta GA, "ontario" CA vs. Canada).
const NON_US = ['india', 'bengaluru', 'bangalore', 'hyderabad', 'mumbai', 'delhi', 'pune',
  'chennai', 'kolkata', 'gurgaon', 'gurugram', 'noida', 'ahmedabad', 'jaipur',
  'canada', 'toronto', 'vancouver', 'montreal', 'ottawa', 'united kingdom', ' uk', '(uk)',
  'london', 'england', 'scotland', 'ireland', 'dublin', 'germany', 'berlin', 'munich',
  'france', 'paris', 'spain', 'madrid', 'barcelona', 'netherlands', 'amsterdam', 'poland',
  'warsaw', 'romania', 'bucharest', 'portugal', 'lisbon', 'italy', 'milan', 'australia',
  'sydney', 'melbourne', 'singapore', 'japan', 'tokyo', 'china', 'beijing', 'shanghai',
  'hong kong', 'brazil', 'mexico', 'argentina', 'colombia', 'israel', 'tel aviv',
  'philippines', 'manila', 'pakistan', 'bangladesh', 'ukraine', 'sweden', 'stockholm',
  'switzerland', 'zurich', 'norway', 'denmark', 'finland', 'belgium', 'austria', 'vienna',
  'emea', 'apac', 'latam', 'uae', 'dubai', 'abu dhabi', 'saudi', 'turkey', 'istanbul']

// Strict USA filter. An explicit US signal wins (so multi-location "New York | London"
// jobs are kept), then any explicit foreign marker excludes, then a bare "remote" with
// no country named is treated as US-eligible. Unknown/empty locations are excluded.
export function isUsaOnly(location) {
  const l = (location || '').toLowerCase().trim()
  if (!l) return false
  if (USA_TOKENS.some(t => l.includes(t)) || US_STATE_ABBR.test(location) || US_WORD.test(location)) return true
  if (NON_US.some(t => l.includes(t))) return false
  return /\bremote\b/.test(l)
}

export function isRemote(location) {
  return /\bremote\b/i.test(location || '')
}

// ─── Stream query (shared by server /api/jobs and the extension dashboard) ───
export const toLightweight = j => ({
  id: j.id, title: j.title, company: j.company, companySlug: j.companySlug,
  companyDomain: j.companyDomain, companyTier: j.companyTier, location: j.location,
  url: j.url, postedAt: j.postedAt, remote: j.remote, source: j.source,
  role: j.role, level: j.level, visa: j.visa, h1b: j.h1b, score: j.scores?.total ?? j.score,
})

export function matchesFilters(j, { role, level, location, workMode, h1bOnly, earlyOnly, q } = {}) {
  const kw = (q || '').toLowerCase().trim()
  if (role && role !== 'all' && j.role !== role) return false
  if (level && level !== 'all' && j.level !== level) return false
  if (location === 'us' && !isUsaOnly(j.location)) return false
  if (workMode === 'remote' && !j.remote) return false
  if (workMode === 'onsite' && j.remote) return false
  if (h1bOnly && !(j.visa !== -1 && (j.h1b ?? 0) >= 50)) return false
  if (earlyOnly && !(j.level === 'entry' || j.level === 'intern')) return false
  if (kw && !`${j.title} ${j.company} ${j.location} ${j.role}`.toLowerCase().includes(kw)) return false
  return true
}

export function queryStream(stream, { offset = 0, limit = 100, ...filters } = {}) {
  const filtered = stream.filter(j => matchesFilters(j, filters))
  const page = filtered.slice(offset, offset + limit).map(toLightweight)
  return { total: filtered.length, offset, count: page.length, jobs: page }
}

// The public feed splits descriptions into shards so the dashboard only downloads
// the slice containing the job a user opens.
export const FEED_SHARDS = 32

export function shardOf(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % FEED_SHARDS
}
