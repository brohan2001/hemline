import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const toRe = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')

describe.each(['manifest.json', 'manifest_firefox.json'])('%s content script matches', (file) => {
  const manifest = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
  const patterns = manifest.content_scripts.flatMap(c => c.matches).map(toRe)

  // Job URLs as they appear in the hosted feed after redirects.
  it.each([
    'https://job-boards.greenhouse.io/pendo/jobs/8678619002',
    'https://job-boards.eu.greenhouse.io/acme/jobs/1',
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://jobs.lever.co/acme/123',
    'https://jobs.ashbyhq.com/acme/abc',
  ])('runs on %s', (url) => {
    expect(patterns.some(re => re.test(url))).toBe(true)
  })
})
