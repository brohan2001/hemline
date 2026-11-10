// Company-board job stream: fetches Greenhouse/Lever/Ashby boards (plus Remotive
// and Jobicy), scores each posting, filters to USA/remote tech roles, and keeps a
// scored, sorted stream in memory (persisted to data/jobs_cache.json). Scoring is
// ported from the myjobs project (src/ranker.py + src/scoring_config.py).
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { isUsaOnly, isRemote, queryStream } from './pipeline/jobfilter.js'

export { isUsaOnly }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const CACHE_PATH = path.join(DATA_DIR, 'jobs_cache.json')

// The last-7-days + USA filters bound the stream sharply, so this is mainly a memory
// safety cap (each job carries its full HTML description). Rarely hit in practice.
const MAX_JOBS = 20000
const RECENT_MS = 7 * 864e5

// ─── Scoring config (ported verbatim from myjobs/src/scoring_config.py) ───────
const SKILL_GROUPS = {
  languages: [1.0, ['python', 'java', 'javascript', 'typescript', 'golang', 'go', 'c++', 'swift', 'scala', 'ruby', 'rust', 'bash', 'shell', 'kotlin']],
  frameworks: [1.2, ['react', 'node.js', 'nodejs', 'django', 'flask', 'express', 'next.js', 'nextjs', 'fastapi', 'spring', 'rails', 'flutter', 'graphql', 'rest api', 'grpc', 'vue', 'angular']],
  cloud: [1.1, ['aws', 'gcp', 'azure', 'lambda', 'ecs', 'eks', 'sqs', 'sns', 'kubernetes', 'k8s', 'docker', 'terraform', 'ansible', 'ci/cd', 'jenkins', 'github actions', 'cloudformation']],
  ml: [1.3, ['pytorch', 'tensorflow', 'scikit-learn', 'hugging face', 'transformers', 'llm', 'nlp', 'opencv', 'pandas', 'numpy', 'spark', 'mlflow', 'wandb', 'langchain', 'rag', 'fine-tuning']],
  databases: [0.9, ['postgresql', 'postgres', 'mongodb', 'mysql', 'redis', 'firebase', 'elasticsearch', 'cassandra', 'dynamodb', 'sqlite', 'bigquery']],
  tools: [0.8, ['git', 'kafka', 'airflow', 'grafana', 'prometheus', 'linux', 'unix', 'jira', 'agile', 'scrum', 'datadog']],
}

const ROLE_PRIORITY = {
  backend: 1.0, cloud: 0.9, fullstack: 0.85, frontend: 0.75,
  mobile: 0.7, network: 0.65, ds: 0.55, ml: 0.5, other: 0.2,
}

const SCORE_WEIGHTS = { skill: 35, role: 25, visa: 20, recency: 10, company: 10 }
const TIER_SCORES = { 1: 1.0, 2: 0.65, 3: 0.35 }
const INDUSTRY_BONUS = { fintech: 0.1, tech: 0.05, enterprise: 0.0 }
const RECENCY_BREAKPOINTS = [[0, 1.0], [1, 0.9], [3, 0.8], [7, 0.6], [14, 0.35], [30, 0.15]]

const SENIOR_TITLE_RE = /\b(senior|sr\.?|staff|principal|lead|director|head of|distinguished|vp|fellow)\b/i
const EARLY_RE = /\b(entry[\s-]level|junior|jr\.?|new\s*grad|early\s*career|associate|university|0[\s-]?[–-]?[\s-]?[12]\s+years?)\b/i

// ─── Runtime config (loaded from disk in initStream) ─────────────────────────
let visaKw = { positive: [], negative: [] }
let roleKw = {}
let companies = []
let h1bData = {}

// ─── Scoring functions ───────────────────────────────────────────────────────
export function classifyRole(title, description) {
  const t = (title || '').toLowerCase()
  const d = (description || '').slice(0, 800).toLowerCase()
  const order = ['ml', 'ds', 'network', 'cloud', 'mobile', 'frontend', 'backend', 'fullstack']
  for (const role of order) for (const kw of roleKw[role] || []) if (t.includes(kw)) return role
  for (const role of order) for (const kw of roleKw[role] || []) if (d.includes(kw)) return role
  return 'other'
}

export function detectVisa(description) {
  const d = (description || '').toLowerCase()
  for (const p of visaKw.negative) if (d.includes(p)) return -1
  for (const p of visaKw.positive) if (d.includes(p)) return 1
  return 0
}

export function detectLevel(title) {
  const t = (title || '').toLowerCase()
  if (/\bintern(ship)?\b/.test(t)) return 'intern'
  if (/\bprincipal\b/.test(t)) return 'principal'
  if (/\bstaff\b/.test(t)) return 'staff'
  if (/\b(lead|director|head of|vp|principal)\b/.test(t)) return 'lead'
  if (/\b(senior|sr\.?)\b/.test(t)) return 'senior'
  if (EARLY_RE.test(t)) return 'entry'
  return 'mid'
}

function parseMaxExperience(description) {
  const matches = [...(description || '').matchAll(/\b(\d+)\+?\s*years?\s*(?:of\s+)?(?:experience|exp)\b/gi)]
  if (!matches.length) return null
  return Math.max(...matches.map(m => parseInt(m[1], 10)))
}

function skillScore(description) {
  const d = (description || '').toLowerCase()
  let matched = 0, total = 0
  for (const [, [weight, skills]] of Object.entries(SKILL_GROUPS)) {
    for (const skill of skills) {
      total += weight
      if (d.includes(skill)) matched += weight
    }
  }
  if (total === 0) return 0
  return Math.min(1.0, (matched / total) * 5.0)
}

function visaScore(signal) {
  if (signal === -1) return 0.0
  if (signal === 1) return 1.0
  return 0.4
}

function recencyScore(postedAt) {
  if (!postedAt) return 0.3
  const t = Date.parse(postedAt)
  if (Number.isNaN(t)) return 0.3
  const daysOld = Math.floor((Date.now() - t) / 864e5)
  for (let i = RECENCY_BREAKPOINTS.length - 1; i >= 0; i--) {
    if (daysOld >= RECENCY_BREAKPOINTS[i][0]) return RECENCY_BREAKPOINTS[i][1]
  }
  return RECENCY_BREAKPOINTS[RECENCY_BREAKPOINTS.length - 1][1]
}

function companyScore(tier, industry) {
  return Math.min(1.0, (TIER_SCORES[tier] ?? 0.35) + (INDUSTRY_BONUS[industry] ?? 0.0))
}

function isSeniorRole(title, description, expMax) {
  if (SENIOR_TITLE_RE.test(title || '')) return true
  if (expMax != null && expMax >= 3 && !EARLY_RE.test(description || '')) return true
  return false
}

export function scoreJob({ title, description, role, visa, postedAt, tier, industry, expMax }) {
  const sk = skillScore(description)
  const ro = ROLE_PRIORITY[role] ?? 0.2
  const vi = visaScore(visa)
  const re = recencyScore(postedAt)
  const co = companyScore(tier, industry)
  let total = sk * SCORE_WEIGHTS.skill + ro * SCORE_WEIGHTS.role + vi * SCORE_WEIGHTS.visa
    + re * SCORE_WEIGHTS.recency + co * SCORE_WEIGHTS.company
  if (isSeniorRole(title, description, expMax)) total *= 0.35
  return {
    total: Math.round(total),
    skill: Math.round(sk * SCORE_WEIGHTS.skill),
    role: Math.round(ro * SCORE_WEIGHTS.role),
    visa: Math.round(vi * SCORE_WEIGHTS.visa),
    recency: Math.round(re * SCORE_WEIGHTS.recency),
    company: Math.round(co * SCORE_WEIGHTS.company),
  }
}

function lookupH1b(name) {
  if (!name) return null
  const lower = name.toLowerCase()
  const key = Object.keys(h1bData).find(
    k => k.toLowerCase() === lower || lower.includes(k.toLowerCase())
  )
  return key !== undefined ? h1bData[key] : null
}

const stripHtml = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// ─── Normalizer: raw posting → scored stream job ─────────────────────────────
function normalize({ source, id, title, description, location, url, postedAt, company }) {
  const descText = stripHtml(description)
  const role = classifyRole(title, descText)
  const visa = detectVisa(descText)
  const level = detectLevel(title)
  const expMax = parseMaxExperience(descText)
  const scores = scoreJob({
    title, description: descText, role, visa, postedAt,
    tier: company.tier, industry: company.industry, expMax,
  })
  return {
    id, title, url, location, postedAt, source, role, level, visa,
    company: company.name, companySlug: company.slug, companyDomain: company.domain,
    companyTier: company.tier, remote: isRemote(location),
    h1b: lookupH1b(company.name), description, scores,
  }
}

// ─── ATS fetchers ────────────────────────────────────────────────────────────
async function fetchJson(url, ms = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'hemline-jobstream/1.0' } })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchGreenhouse(token, company) {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`)
  return (data?.jobs ?? []).map(j => normalize({
    source: 'greenhouse', id: `gh-${token}-${j.id}`, title: j.title ?? '',
    description: decodeEntities(j.content ?? ''), location: j.location?.name ?? '',
    url: j.absolute_url ?? '', postedAt: j.first_published ?? j.updated_at ?? null, company,
  }))
}

async function fetchLever(token, company) {
  const data = await fetchJson(`https://api.lever.co/v0/postings/${token}?mode=json`)
  return (Array.isArray(data) ? data : []).map(j => normalize({
    source: 'lever', id: `lv-${token}-${j.id}`, title: j.text ?? '',
    description: j.description ?? j.descriptionPlain ?? '',
    location: j.categories?.location ?? j.categories?.allLocations?.[0] ?? j.categories?.country ?? '',
    url: j.hostedUrl ?? '', postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null, company,
  }))
}

async function fetchAshby(token, company) {
  const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`)
  return (data?.jobs ?? []).map(j => normalize({
    source: 'ashby', id: `as-${token}-${j.id}`, title: j.title ?? '',
    description: j.descriptionHtml ?? j.descriptionPlain ?? '',
    location: j.location ?? j.locationName ?? '', url: j.jobUrl ?? '',
    postedAt: j.publishedDate ?? j.publishedAt ?? null, company,
  }))
}

async function fetchJsonPost(url, body, ms = 10000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const resp = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'hemline-jobstream/1.0' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Workday lists give a relative "Posted N Days Ago" string instead of a date.
function workdayPostedDate(s) {
  const t = (s || '').toLowerCase()
  if (t.includes('today')) return new Date().toISOString()
  if (t.includes('yesterday')) return new Date(Date.now() - 864e5).toISOString()
  const m = t.match(/(\d+)\+?\s*days?/)
  if (m) return new Date(Date.now() - parseInt(m[1], 10) * 864e5).toISOString()
  return null
}

// Workday: list is cheap and carries the relative post date, so we filter to recent
// postings first, then fetch each one's detail JSON (description + real location).
// Capped per board so a huge careers site can't stall the refresh.
async function fetchWorkday(board, company) {
  const base = `https://${board.host}/wday/cxs/${board.tenant}/${board.site}`
  const list = await fetchJsonPost(`${base}/jobs`, { limit: 100, offset: 0, searchText: '' })
  const recent = []
  for (const p of list?.jobPostings ?? []) {
    const postedAt = workdayPostedDate(p.postedOn)
    if (!postedAt || Date.now() - Date.parse(postedAt) > RECENT_MS + 864e5) continue
    recent.push({ p, postedAt })
    if (recent.length >= 40) break
  }
  const out = []
  for (const { p, postedAt } of recent) {
    const detail = await fetchJson(`${base}/job${p.externalPath}`)
    const info = detail?.jobPostingInfo
    if (!info) continue
    out.push(normalize({
      source: 'workday', id: `wd-${board.tenant}-${info.jobReqId || p.bulletFields?.[0] || p.externalPath}`,
      title: info.title ?? p.title ?? '',
      description: info.jobDescription ?? '',
      location: [info.location, info.country?.descriptor].filter(Boolean).join(', '),
      url: info.externalUrl || `https://${board.host}/en-US/${board.site}${p.externalPath}`,
      postedAt: info.startDate || postedAt, company,
    }))
  }
  return out
}

// SmartRecruiters: list carries an ISO country code (clean USA filter) but no body;
// the description is loaded lazily when the job is opened (see loadDetail).
async function fetchSmartRecruiters(token, company) {
  const data = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`)
  const out = []
  for (const p of data?.content ?? []) {
    if ((p.location?.country || '').toLowerCase() !== 'us') continue
    const job = normalize({
      source: 'smartrecruiters', id: `sr-${token}-${p.id}`, title: p.name ?? '',
      description: '', location: [p.location?.city, p.location?.region, 'US'].filter(Boolean).join(', '),
      url: `https://jobs.smartrecruiters.com/${token}/${p.id}`, postedAt: p.releasedDate ?? null, company,
    })
    job._detail = { type: 'smartrecruiters', url: `https://api.smartrecruiters.com/v1/companies/${token}/postings/${p.id}` }
    out.push(job)
  }
  return out
}

// Recruitee includes the full description and a publish date in the listing.
async function fetchRecruitee(slug, company) {
  const data = await fetchJson(`https://${slug}.recruitee.com/api/offers/`)
  return (data?.offers ?? []).map(o => normalize({
    source: 'recruitee', id: `rc-${slug}-${o.id ?? o.slug}`, title: o.title ?? '',
    description: o.description ?? o.requirements ?? '',
    location: o.location ?? [o.city, o.state_name, o.country].filter(Boolean).join(', '),
    url: o.careers_url ?? `https://${slug}.recruitee.com/o/${o.slug}`,
    postedAt: o.published_at ? new Date(o.published_at).toISOString() : null, company,
  }))
}

// Lazily fetch the description for SmartRecruiters (its listing omits the body).
async function loadDetail(job) {
  if (job.description || !job._detail) return job
  const d = await fetchJson(job._detail.url)
  if (job._detail.type === 'smartrecruiters') {
    const s = d?.jobAd?.sections ?? {}
    job.description = [s.companyDescription, s.jobDescription, s.qualifications, s.additionalInformation]
      .map(x => x?.text).filter(Boolean).join('<br><br>')
  }
  return job
}

// Greenhouse returns HTML-entity-encoded content; decode the common ones so the
// description renders correctly in the detail panel.
function decodeEntities(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

const REMOTIVE_COMPANY = { name: 'Remotive', slug: 'remotive', domain: '', tier: 3, industry: 'tech' }
const JOBICY_COMPANY = { name: 'Jobicy', slug: 'jobicy', domain: '', tier: 3, industry: 'tech' }

async function fetchRemotive() {
  const data = await fetchJson('https://remotive.com/api/remote-jobs?category=software-dev&limit=80')
  return (data?.jobs ?? []).map(j => normalize({
    source: 'remotive', id: `remotive-${j.id}`, title: j.title ?? '',
    description: j.description ?? '', location: j.candidate_required_location ?? 'Remote',
    url: j.url ?? '', postedAt: j.publication_date ?? null,
    company: { ...REMOTIVE_COMPANY, name: j.company_name ?? 'Remotive' },
  }))
}

async function fetchJobicy() {
  const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?geo=usa&industry=engineering&count=50')
  return (data?.jobs ?? []).map(j => normalize({
    source: 'jobicy', id: `jobicy-${j.id}`, title: j.jobTitle ?? '',
    description: j.jobDescription ?? '', location: j.jobGeo ?? 'Remote',
    url: j.url ?? '', postedAt: j.pubDate ?? null,
    company: { ...JOBICY_COMPANY, name: j.companyName ?? 'Jobicy' },
  }))
}

// ─── Concurrency-bounded refresh ─────────────────────────────────────────────
async function runPool(tasks, concurrency = 20) {
  const out = []
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const task = tasks[idx++]
      try { out.push(...await task()) } catch { /* board failed — skip */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return out
}

let STREAM = []
let lastRefreshed = null
let refreshing = false

export async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    const tasks = []
    for (const c of companies) {
      for (const b of c.boards) {
        if (b.ats === 'greenhouse') tasks.push(() => fetchGreenhouse(b.token, c))
        else if (b.ats === 'lever') tasks.push(() => fetchLever(b.token, c))
        else if (b.ats === 'ashby') tasks.push(() => fetchAshby(b.token, c))
        else if (b.ats === 'workday') tasks.push(() => fetchWorkday(b, c))
        else if (b.ats === 'smartrecruiters') tasks.push(() => fetchSmartRecruiters(b.token, c))
        else if (b.ats === 'recruitee') tasks.push(() => fetchRecruitee(b.token, c))
      }
    }
    tasks.push(fetchRemotive, fetchJobicy)

    const all = await runPool(tasks, 20)

    const cutoff = Date.now() - RECENT_MS
    const seen = new Set()
    const jobs = []
    for (const job of all) {
      if (!job.url || seen.has(job.url)) continue
      const t = Date.parse(job.postedAt)
      if (Number.isNaN(t) || t < cutoff) continue                   // last 7 days only (drops undated)
      if (!isUsaOnly(job.location)) continue                        // USA only (India excluded)
      if (job.role === 'other' && job.scores.skill < 7) continue   // drop non-tech noise
      seen.add(job.url)
      jobs.push(job)
    }
    // Strict newest-first so the dashboard date dividers stay monotonic.
    jobs.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0))

    STREAM = jobs.slice(0, MAX_JOBS)
    lastRefreshed = new Date().toISOString()
    await fs.writeFile(CACHE_PATH, JSON.stringify({ ts: lastRefreshed, jobs: STREAM })).catch(() => {})
  } finally {
    refreshing = false
  }
}

// ─── Public accessors ────────────────────────────────────────────────────────
export function queryJobs(params = {}) {
  return queryStream(STREAM, params)
}

export async function getJob(id) {
  const job = STREAM.find(j => j.id === id)
  if (!job) return null
  return loadDetail(job)
}

export function streamMeta() {
  return { streamTotal: STREAM.length, lastRefreshed, refreshing }
}

// Loads scoring config, the company list, and H1-B counts. Returns false if the
// config is missing; used by initStream and by scripts/build-feed.js.
export async function loadConfig() {
  try {
    visaKw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'visa_keywords.json'), 'utf8'))
    roleKw = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'role_keywords.json'), 'utf8'))
    companies = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'companies.json'), 'utf8'))
  } catch (err) {
    console.error('jobstream: failed to load config —', err.message)
    return false
  }
  try {
    h1bData = JSON.parse(await fs.readFile(path.join(__dirname, 'h1b_data.json'), 'utf8'))
  } catch { /* no h1b file — badges just won't show */ }
  return true
}

export function getStream() {
  return { jobs: STREAM, lastRefreshed }
}

// Loads config + cached jobs, then kicks a background refresh. Safe to call once
// at server startup. Never throws — a cold start with no cache just shows empty.
export async function initStream() {
  if (!(await loadConfig())) return
  try {
    const cached = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'))
    if (Array.isArray(cached.jobs)) { STREAM = cached.jobs; lastRefreshed = cached.ts }
  } catch { /* no cache yet */ }

  refresh()                                   // background — don't await
  setInterval(refresh, 15 * 60 * 1000)
}
