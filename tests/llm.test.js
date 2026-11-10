import { describe, it, expect, vi } from 'vitest'
import { callLlm, callOne } from '../llm.js'

function okFetch(text) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) }))
}

function statusFetch(status) {
  return vi.fn(async () => ({ ok: false, status, text: async () => 'nope' }))
}

function fakeAnthropic(message) {
  const stream = vi.fn(() => ({ finalMessage: async () => message }))
  return { stream, createClient: vi.fn(() => ({ beta: { messages: { stream } } })) }
}

describe('callLlm cascade', () => {
  it('errors clearly when no keys are configured', async () => {
    await expect(callLlm('p', [])).rejects.toThrow(/No API key configured/)
    await expect(callLlm('p', [{ provider: 'gemini', key: '  ' }])).rejects.toThrow(/No API key configured/)
  })

  it('falls through a rate-limited key to the next one', async () => {
    const fetchImpl = vi.fn()
      .mockImplementationOnce(statusFetch(429))
      .mockImplementationOnce(okFetch('from groq'))
    const onSuccess = vi.fn()
    const text = await callLlm('p', [
      { provider: 'gemini', key: 'g' },
      { provider: 'groq', key: 'q' },
    ], { fetchImpl, onSuccess })
    expect(text).toBe('from groq')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toContain('api.groq.com')
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ provider: 'groq' }))
  })

  it('reports every failure when all keys fail', async () => {
    await expect(callLlm('p', [
      { provider: 'gemini', key: 'g' },
      { provider: 'cerebras', key: 'c' },
    ], { fetchImpl: statusFetch(401) })).rejects.toThrow(/Google Gemini: invalid API key \| Cerebras: invalid API key/)
  })
})

describe('OpenAI-compatible providers', () => {
  it('sends a bearer key and the default model', async () => {
    const fetchImpl = okFetch('hi')
    await callOne({ provider: 'gemini', key: 'secret' }, 'prompt', { fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gemini-3.5-flash', messages: [{ role: 'user', content: 'prompt' }] })
  })
})

describe('model selection', () => {
  it('ignores a saved model the provider no longer lists', async () => {
    const fetchImpl = okFetch('hi')
    await callOne({ provider: 'cerebras', key: 'c', model: 'zai-glm-4.7' }, 'p', { fetchImpl })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('gpt-oss-120b')
  })

  it('tries the next model when one is retired (404)', async () => {
    const fetchImpl = vi.fn()
      .mockImplementationOnce(statusFetch(404))
      .mockImplementationOnce(okFetch('from fallback'))
    const text = await callOne({ provider: 'groq', key: 'q' }, 'p', { fetchImpl })
    expect(text).toBe('from fallback')
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('qwen/qwen3.8-27b')
  })

  it('tries the next model when one is overloaded (503)', async () => {
    const fetchImpl = vi.fn()
      .mockImplementationOnce(statusFetch(503))
      .mockImplementationOnce(okFetch('from 2.5'))
    expect(await callOne({ provider: 'gemini', key: 'g' }, 'p', { fetchImpl })).toBe('from 2.5')
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('gemini-2.5-flash')
  })

  it('does not retry other models on rate limits', async () => {
    const fetchImpl = statusFetch(429)
    await expect(callOne({ provider: 'groq', key: 'q' }, 'p', { fetchImpl })).rejects.toThrow(/429/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('Anthropic provider', () => {
  const done = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'resume' }] }

  it('uses the SDK in browser mode with refusal fallbacks on Opus', async () => {
    const { stream, createClient } = fakeAnthropic(done)
    expect(await callOne({ provider: 'anthropic', key: 'sk' }, 'p', { createClient })).toBe('resume')
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk', dangerouslyAllowBrowser: true }))
    expect(stream.mock.calls[0][0]).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
  })

  it('omits fallbacks for Haiku', async () => {
    const { stream, createClient } = fakeAnthropic(done)
    await callOne({ provider: 'anthropic', key: 'sk', model: 'claude-haiku-5-5' }, 'p', { createClient })
    expect(stream.mock.calls[0][0].fallbacks).toBeUndefined()
    expect(stream.mock.calls[0][0].betas).toBeUndefined()
  })

  it('treats a refusal as a failure so the cascade moves on', async () => {
    const { createClient } = fakeAnthropic({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] })
    const text = await callLlm('p', [
      { provider: 'anthropic', key: 'sk' },
      { provider: 'gemini', key: 'g' },
    ], { createClient, fetchImpl: okFetch('gemini text') })
    expect(text).toBe('gemini text')
  })
})
