import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    execFile: vi.fn(),
    execSync: vi.fn(() => Buffer.from('/usr/local/bin/claude')),
  }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      readdir: vi.fn().mockResolvedValue([]),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  }
})

import { appendLedger } from '../server.js'

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockWriteFile.mockResolvedValue(undefined)
})

const ENTRY = { company: 'Acme', title: 'SWE', date: '2026-05-30', resumePath: 'resumes/Rohan_Resume_Acme.pdf', clPath: null }

describe('appendLedger', () => {
  it('creates a new array when ledger file does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await appendLedger(ENTRY)

    const written = JSON.parse(mockWriteFile.mock.calls[0][1])
    expect(Array.isArray(written)).toBe(true)
    expect(written).toHaveLength(1)
    expect(written[0].company).toBe('Acme')
  })

  it('appends to an existing valid JSON array', async () => {
    const existing = [{ company: 'Prev', title: 'Eng', date: '2026-01-01', resumePath: 'resumes/r.pdf', clPath: null }]
    mockReadFile.mockResolvedValueOnce(JSON.stringify(existing))

    await appendLedger(ENTRY)

    const written = JSON.parse(mockWriteFile.mock.calls[0][1])
    expect(written).toHaveLength(2)
    expect(written[1].company).toBe('Acme')
  })

  it('resets to a one-entry array when existing JSON is malformed', async () => {
    mockReadFile.mockResolvedValueOnce('{ this is not json {{')

    await appendLedger(ENTRY)

    const written = JSON.parse(mockWriteFile.mock.calls[0][1])
    expect(written).toHaveLength(1)
    expect(written[0].company).toBe('Acme')
  })
})
