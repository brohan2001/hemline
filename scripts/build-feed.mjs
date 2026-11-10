// Builds the public static job feed consumed by the extension dashboard.
// Runs the same scraper/scorer as the local server once, then writes:
//   <out>/jobs.json            lightweight list, newest first
//   <out>/details/<n>.json     plain-text descriptions + score breakdown, sharded
//   <out>/*                    static pages copied from site/ (landing, privacy)
//   node scripts/build-feed.mjs [outDir=_site]
import { mkdir, writeFile, cp, rm } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig, refresh, getStream } from '../jobstream.js'
import { toLightweight, shardOf, FEED_SHARDS } from '../pipeline/jobfilter.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_DESC = 6000

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

export function buildFeed(jobs, ts) {
  const shards = Array.from({ length: FEED_SHARDS }, () => ({}))
  for (const j of jobs) {
    shards[shardOf(j.id)][j.id] = {
      description: htmlToText(j.description).slice(0, MAX_DESC),
      scores: j.scores,
    }
  }
  return {
    index: { ts, total: jobs.length, shards: FEED_SHARDS, jobs: jobs.map(toLightweight) },
    shards,
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const out = path.resolve(process.argv[2] ?? '_site')
  if (!(await loadConfig())) process.exit(1)
  const t0 = Date.now()
  await refresh()
  const { jobs, lastRefreshed } = getStream()
  if (jobs.length === 0) {
    console.error('Feed build produced 0 jobs; refusing to publish an empty feed.')
    process.exit(1)
  }
  const { index, shards } = buildFeed(jobs, lastRefreshed)
  await rm(out, { recursive: true, force: true })
  await mkdir(path.join(out, 'details'), { recursive: true })
  await cp(path.join(ROOT, 'site'), out, { recursive: true })
  await writeFile(path.join(out, 'jobs.json'), JSON.stringify(index))
  await Promise.all(shards.map((s, i) => writeFile(path.join(out, 'details', `${i}.json`), JSON.stringify(s))))
  console.log(`Feed: ${jobs.length} jobs in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`)
}
