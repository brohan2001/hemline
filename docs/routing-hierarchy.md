# Relay Routing Hierarchy

## Overview

When the Node server forwards a request to RelayFreeLLM with a specific `provider/model`, RelayFreeLLM's `model_dispatcher.py` automatically cascades through all 19 models in `INTENT_HIERARCHY` order before reporting failure back to Node. From Node's perspective, one HTTP call is made per endpoint request; the cascade is fully transparent.

The Node server selects the **primary model** (first candidate):
- `/tailor` and `/cold-message`: `RELAY_MODEL` env var (default: `google/gemini-3.5-flash`)
- `/cover-letter`: `RELAY_CL_MODEL` env var (default: `cerebras/zai-glm-4.7`)

RelayFreeLLM then tries that model first, and if it fails (rate limit, API error, auth error), proceeds down the hierarchy.

---

## INTENT_HIERARCHY (from `src/model_selector.py`)

| Rank | Provider  | Model                    | Tier     | Notes                                     |
|------|-----------|--------------------------|----------|-------------------------------------------|
| 1    | Gemini    | gemini-3.5-flash         | Primary  | Default resume primary; fastest Gemini    |
| 2    | Groq      | openai/gpt-oss-120b      | Primary  | GPT-class OSS model on Groq infra         |
| 3    | Groq      | llama-3.3-70b-versatile  | Primary  | Strong general-purpose Llama              |
| 4    | Groq      | qwen/qwen3-32b           | Primary  | Strong reasoning, good at structured text |
| 5    | Gemini    | gemini-2.5-flash         | Primary  | Previous-gen Gemini flash                 |
| 6    | Cerebras  | zai-glm-4.7              | Primary  | Default CL primary; fast Cerebras model   |
| 7    | Gemini    | gemma-4-31b              | Secondary| Open-weights Gemma via Google AI Studio   |
| 8    | Groq      | llama-4-scout-17b        | Secondary| Compact Llama 4 scout variant             |
| 9    | Gemini    | gemma-4-26b              | Secondary| Smaller Gemma 4 variant                   |
| 10   | Groq      | groq/compound            | Secondary| Groq compound routing model               |
| 11   | Groq      | openai/gpt-oss-20b       | Secondary| Smaller OSS GPT variant                   |
| 12   | Groq      | groq/compound-mini       | Secondary| Compact compound routing                  |
| 13   | Groq      | llama-3.1-8b-instant     | Fallback | Fastest Groq model; lower quality         |
| 14   | Gemini    | gemini-3-flash           | Fallback | Older Gemini flash generation             |
| 15   | Gemini    | gemini-3.1-flash-lite    | Fallback | Lite flash variant                        |
| 16   | Gemini    | gemini-2.5-flash-lite    | Fallback | Lightweight Gemini 2.5                    |
| 17   | Groq      | allam-2-7b               | Fallback | Arabic-optimized, used as last Groq resort|
| 18   | Groq      | orpheus-v1-english       | Fallback | English TTS-focused model                 |
| 19   | Groq      | orpheus-arabic-saudi     | Fallback | Lowest priority; Saudi Arabic variant     |

---

## Cascade Mechanics

**Defined in:** `RelayFreeLLM/src/model_dispatcher.py` (Case 1 — Specific Routing)

1. Client requests `provider/model` (e.g., `google/gemini-3.5-flash`).
2. Dispatcher builds candidate list: `[primary, ...remaining INTENT_HIERARCHY models in rank order]`.
3. Iterates candidates, calling the provider API for each.
4. On success: returns 200 with the content.
5. On failure (`ProviderError`, `RateLimitError`, `AuthenticationError`): triggers circuit breaker for that model and tries next.
6. If all 19 exhausted: returns error to Node.

**Circuit breaker cooldowns** (from `model_selector.py`):
- Rate limit error: 60-second cooldown
- Other errors: 30-second cooldown

During cooldown, a model is skipped automatically. This prevents hammering a rate-limited API.

---

## Tier Rationale

**Primary (Ranks 1–6):** High-quality models from providers with generous free tiers. These produce the best LaTeX output for resume/cover letter generation.

**Secondary (Ranks 7–12):** Capable models with narrower free quotas or slightly lower structured-output quality. Used when primary tier is exhausted.

**Fallback (Ranks 13–19):** Speed-optimized or niche models. May produce shorter or lower-quality output; acceptable for cold messages but suboptimal for LaTeX resume generation.

---

## Node-Side Logging

For each relay call, Node logs one line:
```
[Relay] google/gemini-3.5-flash -> Success
[Relay] cerebras/zai-glm-4.7 -> Failed (no choices[0]: ...)
```

Full prompt text, raw API choices JSON, and error traces are written to `logs/pipeline.log` for every request.
