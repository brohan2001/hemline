import Anthropic from './vendor/anthropic-sdk.js'

// Bring-your-own-key LLM access for the extension. Users store an ordered list of
// { provider, key, model } entries; callLlm tries them in order and falls through
// on any failure (bad key, rate limit, outage) so one exhausted free tier never
// blocks a request.

export const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic API)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    free: false,
  },
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-3.5-flash', 'gemini-2.5-flash'],
    free: true,
  },
  groq: {
    label: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
    free: true,
  },
  cerebras: {
    label: 'Cerebras',
    keyUrl: 'https://cloud.cerebras.ai/',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    models: ['gpt-oss-120b', 'qwen-3.8-27b'],
    free: false,
  },
}

export const HOST_PERMISSIONS = [
  'https://api.anthropic.com/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.groq.com/*',
  'https://api.cerebras.ai/*',
]

// Haiku has no server-side refusal fallback; Opus/Sonnet route by refusal category.
const SUPPORTS_FALLBACKS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

async function callAnthropic({ key, model }, prompt, { createClient, fast }) {
  const client = createClient({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 })
  const params = {
    model,
    max_tokens: 16000,
    output_config: { effort: fast ? 'low' : 'medium' },
    messages: [{ role: 'user', content: prompt }],
  }
  if (SUPPORTS_FALLBACKS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01']
    params.fallbacks = 'default'
  }
  // Streaming keeps bytes flowing during long generations, which avoids HTTP
  // timeouts and keeps the MV3 service worker from idling out mid-request.
  const message = await client.beta.messages.stream(params).finalMessage()
  if (message.stop_reason === 'refusal') {
    throw new Error(`Claude declined the request (${message.stop_details?.category ?? 'refusal'})`)
  }
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('')
  if (message.stop_reason === 'max_tokens') throw new Error('Claude output was truncated (max_tokens)')
  return text
}

async function callOpenAiCompatible({ provider, key, model }, prompt, { fetchImpl, fast }) {
  const res = await fetchImpl(PROVIDERS[provider].url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 16384,
      // Fast mode: these models otherwise "think" for 30-90 s on a tailoring prompt.
      // 'low' is the one value every listed model accepts (gpt-oss rejects 'none').
      ...(fast ? { reasoning_effort: 'low' } : {}),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`${PROVIDERS[provider].label} HTTP ${res.status}: ${body.slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error(`${PROVIDERS[provider].label} returned no content`)
  return text
}

export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError || err?.status === 401 || err?.status === 403) return 'invalid API key'
  if (err instanceof Anthropic.RateLimitError || err?.status === 429) return 'rate limited / quota exhausted'
  if (err?.status === 402) return 'payment required (add billing in the provider console)'
  if (err instanceof Anthropic.APIError && err.status >= 500) return `provider error ${err.status}`
  return err?.message ?? String(err)
}

export async function callOne(entry, prompt, deps = {}) {
  const resolved = {
    createClient: deps.createClient ?? (opts => new Anthropic(opts)),
    fetchImpl: deps.fetchImpl ?? ((...a) => fetch(...a)),
    fast: deps.fast ?? true,
  }
  const p = PROVIDERS[entry.provider]
  if (!p) throw new Error(`Unknown provider: ${entry.provider}`)
  // Saved entries keep the model chosen when the key was added; providers retire
  // models, so an unlisted one is ignored. A 404 (model gone) or 5xx (model
  // overloaded) tries the provider's next model before giving up on the key.
  const first = p.models.includes(entry.model) ? entry.model : p.models[0]
  const models = [first, ...p.models.filter(m => m !== first)]
  for (const [i, model] of models.entries()) {
    try {
      return entry.provider === 'anthropic'
        ? await callAnthropic({ ...entry, model }, prompt, resolved)
        : await callOpenAiCompatible({ ...entry, model }, prompt, resolved)
    } catch (err) {
      const retryable = err?.status === 404 || err?.status >= 500
      if (!retryable || i === models.length - 1) throw err
    }
  }
}

export async function callLlm(prompt, keys, deps = {}) {
  const usable = (keys ?? []).filter(k => k?.key?.trim())
  if (usable.length === 0) throw new Error('No API key configured. Open the Hemline options page and add a Claude or free Gemini key.')
  const failures = []
  for (const entry of usable) {
    try {
      const text = await callOne(entry, prompt, deps)
      deps.onSuccess?.(entry)
      return text
    } catch (err) {
      failures.push(`${PROVIDERS[entry.provider]?.label ?? entry.provider}: ${describeError(err)}`)
    }
  }
  throw new Error(`All configured LLM keys failed. ${failures.join(' | ')}`)
}
