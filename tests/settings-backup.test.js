import { describe, it, expect } from 'vitest'
import { buildSettingsBackup, parseSettingsBackup } from '../store.js'
import { PROVIDERS } from '../llm.js'

const TEX = '\\documentclass{article}\\begin{document}x\\end{document}'

describe('buildSettingsBackup', () => {
  it('exports profile, resume and pools but never API keys', () => {
    const backup = buildSettingsBackup({
      llmKeys: [{ provider: 'gemini', key: 'secret' }],
      profile: { firstName: 'Alex' }, resumeTex: TEX, projectPool: 'pool', skillPools: { 'skills_pool.txt': 'Go' }, backend: 'extension',
    })
    expect(backup).toEqual({ hemline: 1, profile: { firstName: 'Alex' }, resumeTex: TEX, projectPool: 'pool', skillPools: { 'skills_pool.txt': 'Go' } })
    expect(JSON.stringify(backup)).not.toContain('secret')
  })

  it('round-trips through parseSettingsBackup', () => {
    const backup = buildSettingsBackup({ profile: { firstName: 'Alex', city: 'Denver' }, resumeTex: TEX })
    expect(parseSettingsBackup(JSON.stringify(backup), PROVIDERS)).toEqual({ profile: { firstName: 'Alex', city: 'Denver' }, resumeTex: TEX })
  })
})

describe('parseSettingsBackup', () => {
  const parse = obj => parseSettingsBackup(JSON.stringify(obj), PROVIDERS)

  it('keeps only known profile fields and stringifies values', () => {
    expect(parse({ profile: { firstName: ' Alex ', zip: 80202, unknown: 'x', email: '' } }).profile)
      .toEqual({ firstName: 'Alex', zip: '80202' })
  })

  it('accepts a skill pool as a plain string', () => {
    expect(parse({ skillPools: 'Go, Rust' }).skillPools).toEqual({ 'skills_pool.txt': 'Go, Rust' })
  })

  it('imports valid keys and replaces unknown models', () => {
    expect(parse({ llmKeys: [{ provider: 'groq', key: ' k ', model: 'gone' }, { provider: 'nope', key: 'x' }, { provider: 'gemini', key: '' }] }).llmKeys)
      .toEqual([{ provider: 'groq', key: 'k', model: PROVIDERS.groq.models[0] }])
  })

  it('rejects bad input with a clear message', () => {
    expect(() => parseSettingsBackup('{oops', PROVIDERS)).toThrow(/valid JSON/)
    expect(() => parse([])).toThrow(/JSON object/)
    expect(() => parse({ resumeTex: 'plain text' })).toThrow(/LaTeX/)
    expect(() => parse({ hemline: 1 })).toThrow(/Nothing to import/)
  })
})
