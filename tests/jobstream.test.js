import { describe, it, expect } from 'vitest'
import { scoreJob, detectLevel, isUsaOnly } from '../jobstream.js'

describe('isUsaOnly', () => {
  it('accepts US locations, bare remote, and multi-location jobs with a US option', () => {
    for (const loc of ['San Francisco, CA', 'New York, NY', 'Austin, Texas', 'Remote',
                       'United States', 'Seattle, WA', 'Remote - US', 'New York, NY | London, UK']) {
      expect(isUsaOnly(loc), loc).toBe(true)
    }
  })
  it('rejects India, other non-US locations, remote-in-a-foreign-country, and unknown/empty', () => {
    for (const loc of ['Bengaluru, India', 'Remote, India', 'London, UK', 'Berlin, Germany',
                       'Toronto, Canada', 'Singapore', 'Remote - EMEA', '']) {
      expect(isUsaOnly(loc), loc).toBe(false)
    }
  })
})

describe('detectLevel', () => {
  it('classifies seniority from the title', () => {
    expect(detectLevel('Senior Software Engineer')).toBe('senior')
    expect(detectLevel('Staff ML Engineer')).toBe('staff')
    expect(detectLevel('Principal Engineer')).toBe('principal')
    expect(detectLevel('Software Engineer, New Grad')).toBe('entry')
    expect(detectLevel('Software Engineering Intern')).toBe('intern')
    expect(detectLevel('Engineering Lead, Platform')).toBe('lead')
    expect(detectLevel('Software Engineer')).toBe('mid')
  })
})

describe('scoreJob', () => {
  const base = {
    title: 'Software Engineer', description: 'python aws kubernetes docker postgresql react typescript',
    role: 'fullstack', visa: 1, postedAt: new Date().toISOString(), tier: 1, industry: 'tech', expMax: null,
  }

  it('returns weighted sub-scores within their caps and a total out of 100', () => {
    const s = scoreJob(base)
    expect(s.skill).toBeLessThanOrEqual(35)
    expect(s.role).toBeLessThanOrEqual(25)
    expect(s.visa).toBe(20)
    expect(s.recency).toBe(10)
    expect(s.company).toBe(10)
    expect(s.total).toBeGreaterThan(50)
  })

  it('applies the senior-role penalty (0.35x) to senior titles', () => {
    const junior = scoreJob(base)
    const senior = scoreJob({ ...base, title: 'Senior Software Engineer' })
    expect(senior.total).toBeLessThan(junior.total)
    expect(senior.total).toBe(Math.round(
      (junior.skill + junior.role + junior.visa + junior.recency + junior.company) * 0.35
    ))
  })

  it('penalizes a confirmed no-sponsorship signal', () => {
    expect(scoreJob({ ...base, visa: -1 }).visa).toBe(0)
    expect(scoreJob({ ...base, visa: 0 }).visa).toBe(8)
  })
})
