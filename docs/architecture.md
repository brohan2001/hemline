# JSeek Enhancer — Architecture

## Overview

```
┌──────────────────────────────────────────────────────┐
│                  Chrome Browser                       │
│                                                       │
│   any job page (12 mapped platforms + universal)      │
│   ┌─────────────────────────────────────────────┐    │
│   │  content_script.js                          │    │
│   │  • Injects UI (buttons, badges, toggles)    │    │
│   │  • Scrapes job descriptions from DOM        │    │
│   │  • Universal semantic scraper on unmapped   │    │
│   │    hosts (text density × JD keyword score)  │    │
│   │  • ATS Auto-Fill (Greenhouse/Lever/Workday) │    │
│   │  • Reads h1b_data.json (bundled asset)      │    │
│   │  • POSTs to localhost:4567 endpoints        │    │
│   │  • Sends DOWNLOAD_PDF message → background  │    │
│   │  • Stagger between /tailor & /cover-letter  │    │
│   └──────────────┬──────────────────────────────┘    │
│                  │ chrome.runtime.sendMessage         │
│   ┌──────────────▼──────────────────────────────┐    │
│   │  background.js (Service Worker)             │    │
│   │  • Listens for DOWNLOAD_PDF                 │    │
│   │  • Calls chrome.downloads.download()        │    │
│   └─────────────────────────────────────────────┘    │
└────────────────────┬─────────────────────────────────┘
                     │ HTTP POST (application/json)
┌────────────────────▼─────────────────────────────────┐
│              server.js  (Express, port 4567)          │
│                                                       │
│  POST /tailor         → tailors swe.tex + PDF         │
│  POST /cover-letter   → generates CL .tex + PDF       │
│  POST /cold-message   → returns plain-text message    │
│  POST /cold-email     → returns { subject, body }     │
│  GET  /api/jobs       → live job stream (3 free APIs) │
│  GET  /               → local web dashboard           │
│  GET  /health         → provider + pdflatex status    │
│  GET  /applications   → ledger (+ /check dup guard)   │
│  GET  /stats          → pipeline.log aggregates       │
│                                                       │
│  LLM routing:                                         │
│    provider = req.body.provider || LLM_PROVIDER       │
│    relay  → callRelay(prompt, primaryModel)           │
│    claude → runClaude(bin, prompt, cwd)               │
│                                                       │
│  After /cover-letter PDF is sent:                     │
│    Rohan_CL_*.tex + Rohan_CL_*.pdf deleted async      │
└───────────┬───────────────────────────────────────────┘
            │ HTTP POST /v1/chat/completions
┌───────────▼───────────────────────────────────────────┐
│         RelayFreeLLM  (FastAPI, port 8000)             │
│                                                       │
│  model_dispatcher.py (Case 1 — Specific Routing)      │
│    1. Primary model tried first                       │
│    2. Falls back through INTENT_HIERARCHY (19 models) │
│    3. Circuit breaker: 60s (rate limit) / 30s (other) │
│                                                       │
│  model_selector.py                                    │
│    INTENT_HIERARCHY: 19-model ordered priority list   │
│    Providers: Gemini, Groq, Cerebras                  │
└───────────┬───────────────────────────────────────────┘
            │ Provider API calls
    ┌───────┴────────┬─────────────────┐
    ▼                ▼                 ▼
 Google AI        Groq API        Cerebras API
 Studio (free)   (free tier)      (free tier)
```

---

## File Responsibilities

| File | Responsibility |
|---|---|
| `manifest.json` | Chrome extension manifest V3 — permissions, host rules, script declarations |
| `content_script.js` | All DOM interaction: button/badge/toggle injection, JD scraping, fetch to server |
| `background.js` | Service worker — handles `chrome.downloads.download()` on behalf of content script |
| `server.js` | Express bridge — all LLM endpoints, pdflatex compilation, relay routing |
| `package.json` | Node server dependencies and run scripts |
| `h1b_data.json` | Static company → H1-B sponsorship count lookup, loaded by content script |
| `site_configs.js` | Per-site DOM selector configs for 12 job boards + `universal` runtime fallback |
| `public/index.html` | Local web dashboard — 2-column job stream + tailoring panel, ledger, stats |
| `options.html` / `options.js` | Extension options page — edit the Auto-Fill profile (chrome.storage) |
| `tests/ui_live.test.js` | Playwright E2E — loads the unpacked extension, asserts injection on live pages |
| `README.md` | Setup and usage guide for the whole system |
| `docs/architecture.md` | This file |
| `docs/routing-hierarchy.md` | Full 19-model priority list, tiers, cascade logic |
| `docs/relay-llm-setup.md` | How to install and configure RelayFreeLLM |
| `docs/my-customizations.md` | Prompt-tuning decisions, anti-AI style rules, LaTeX constraints |
| `CLAUDE.md` | Ops runbook for Claude Code sessions |

---

## System Data Flows

### Feature 1 — LaTeX Resume Tailor (`/tailor`)

```
User clicks [ Resume ] on a job page
  → content_script.js scrapes innerText of job description container
  → POST http://localhost:4567/tailor  { jobDescription, companyName, jobTitle, provider }
  → server.js reads swe.tex + skills_*.txt
  → callRelay(prompt, RELAY_MODEL) or runClaude(bin, prompt)
      RelayFreeLLM tries primary model, cascades through 19 if needed
  → extractLatex() + graftPreamble() + sanitizeSkillsAmpersands()
  → applySkillsLineTrimmer() clamps rows 2–4 to ≤105 visible chars
  → writes modified swe.tex
  → pdflatex compiles → swe.pdf
  → server reads swe.pdf → sends application/pdf
  → content_script.js blob URL → DOWNLOAD_PDF → background.js → Downloads
```

### Feature 2 — Cover Letter (`/cover-letter`)

```
User clicks [ Resume & CL ] on a job page
  → content_script.js: fires /tailor first, awaits, then sleeps 1s, then fires /cover-letter
  → POST http://localhost:4567/cover-letter  { jd, companyName, jobTitle, provider }
  → server.js reads swe.tex + cover_letter_template.tex + skills_*.txt
  → callRelay(prompt, RELAY_CL_MODEL) — defaults to cerebras/zai-glm-4.7
  → extractLatex() + graftPreamble()
  → writes Rohan_CL_{safe}.tex
  → pdflatex compiles → Rohan_CL_{safe}.pdf
  → server reads PDF → sends application/pdf
  → AFTER res.send(): Rohan_CL_*.tex and Rohan_CL_*.pdf deleted asynchronously
  → resumes/ contains only master files after completion
```

### Feature 3 — Cold Message (`/cold-message`)

```
User clicks [ Message ] on a job page
  → POST http://localhost:4567/cold-message  { jd, companyName, jobTitle, provider }
  → server.js reads swe.tex
  → callRelay(prompt, RELAY_MODEL) or runClaude
  → returns { message: "<4 sentences, <300 chars>" }
  → content_script.js copies to clipboard + opens LinkedIn recruiter search tab
```

### Feature 4 — Enhanced Seniority Filter

```
User visits jseek.co watchlist page
  → content_script.js injects "Enhanced Early Career" toggle
User clicks toggle ON
  → Hides titles matching /senior|lead|staff/i
  → Shows/highlights titles matching /associate|junior|\bII\b|0-3 years|grad|entry/i
```

### Feature 5 — H1-B Sponsorship Badge & Filter

```
Page load on jseek.co
  → content_script.js fetches h1b_data.json via chrome.runtime.getURL()
  → Injects "H1-B: N sponsored" badge on each company card
  → Injects "H1-B Sponsors Only" toggle
User clicks toggle ON
  → Hides cards with sponsorship count < 50 (H1B_THRESHOLD)
```

### Feature 6 — LinkedIn Recruiter Finder

```
content_script.js runs on jseek.co
  → Injects LinkedIn SVG icon after each company name element
User clicks icon
  → Opens LinkedIn recruiter search tab for that company
```

### Feature 7 — Live Job Stream Dashboard (`GET /api/jobs`)

```
User opens http://localhost:4567
  → dashboard fires GET /api/jobs
  → server fetches in parallel (Promise.allSettled — one source down ≠ stream down):
      Arbeitnow  https://www.arbeitnow.com/api/job-board-api
      Remotive   https://remotive.com/api/remote-jobs?category=software-dev&limit=50
      Jobicy     https://jobicy.com/api/v2/remote-jobs?geo=usa&industry=engineering&count=20
  → each result normalized to { id, title, company, location, url, description, tags, remote, source }
  → deduplicated on url → { count, jobs }
  → left column renders job cards (keyword filter + refresh)
User clicks a card
  → description (HTML-stripped), company, and title populate the right tailoring panel
  → Tailor Resume / CL / Cold Message run against the loaded job
```

### Feature 8 — Universal Semantic Scraper (unmapped hosts)

```
detectSite() finds no hostname match
  → returns SITE_CONFIGS.universal (all selectors null, resolved at runtime)
  → findUniversalElements(): every <section>/<article>/<div>/<main> scored by
      text density × JD-keyword hits × log(text length)
      keywords: requirements, responsibilities, qualifications, benefits, …
      blocks under 200 or over 20000 chars score 0
  → highest-scoring element = job description + inject target (beforebegin)
  → title: first h1 → h2 → document.title; company: og:site_name → [class*="company"]
  → zero score on non-job pages → nothing injected
Manifests carry *://*/* so the content script can run anywhere.
```

### Feature 9 — ATS Auto-Fill (Greenhouse / Lever / Workday)

```
User clicks [ Auto-Fill ] above the application form
  → autoFillForm() matches each empty input/textarea by name/id/placeholder/
    aria-label/data-automation-id/label against FIELD_PATTERNS
  → setFieldValue(): native prototype value setter (bypasses React's fiber shim)
      + InputEvent { bubbles, composed } (crosses Workday shadow DOM)
      + change event → frameworks register the value as user input
  → profile from chrome.storage (options page) or DEFAULT_PROFILE fallback
```

---

## LLM Provider Routing

```
Server startup (isMain only)
  → maybeSpawnRelay()
      ├── LLM_PROVIDER !== "relay"  → skip
      └── LLM_PROVIDER === "relay"
            ├── TCP probe port 8000 occupied  → log "already running", skip
            └── port free  → spawn python3 -m src.server (cwd: RELAY_DIR, stdio: inherit)

Express endpoint
  → provider = req.body.provider || process.env.LLM_PROVIDER || 'claude'
  → relay path:
      /tailor, /cold-message  → callRelay(prompt, RELAY_MODEL || 'google/gemini-3.5-flash')
      /cover-letter           → callRelay(prompt, RELAY_CL_MODEL || 'cerebras/zai-glm-4.7')
  → claude path:
      runClaude(claudePath, prompt, __dirname)

callRelay logs:
  [Relay] google/gemini-3.5-flash -> Success
  [Relay] cerebras/zai-glm-4.7   -> Failed (error msg)
  Full prompt + raw choices written to logs/pipeline.log
```

---

## Configuration Parameters

| Parameter | Value | Location |
|---|---|---|
| Server port | `4567` | `server.js` constant `PORT` |
| CORS origin | `*` (open) | `server.js` cors config |
| Claude CLI path | Auto-discovered via `which claude` at startup | `server.js` startup block |
| Resume directory | `resumes/` relative to project root | `server.js` constant `RESUMES_DIR` |
| H1-B threshold | `50` (hide if count < threshold) | `content_script.js` constant `H1B_THRESHOLD` |
| Skills trimmer cap | `105` visible chars (rows 2–4) | `server.js` `applySkillsLineTrimmer` |
| RelayFreeLLM port | `8000` | `checkPort(8000)` in `maybeSpawnRelay` |

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `relay` | `relay` = RelayFreeLLM gateway; `claude` = Claude CLI subprocess |
| `RELAY_URL` | `http://localhost:8000/v1/chat/completions` | RelayFreeLLM OpenAI-compatible endpoint |
| `RELAY_MODEL` | `google/gemini-3.5-flash` | Primary model for `/tailor` and `/cold-message` |
| `RELAY_CL_MODEL` | `cerebras/zai-glm-4.7` | Primary model for `/cover-letter` |
| `RELAY_DIR` | `/Users/rohanbalasubramanian/Documents/RelayFreeLLM` | Path to RelayFreeLLM repo for auto-spawn |
| `CLAUDE_MODEL` | _(default Sonnet)_ | Override Claude CLI model (e.g., `claude-haiku-4-5-20251001`) |

### `resumes/` Directory Discipline

After a successful request, only these files remain:
- `swe.tex` — master resume LaTeX template (modified in-place by `/tailor`)
- `cover_letter_template.tex` — CL template (never modified)
- `skills_ds.txt`, `skills_ml.txt`, `skills_cloud.txt`, `skills_network.txt` — skill pools

Generated `Rohan_CL_*.tex`, `Rohan_CL_*.pdf`, and pdflatex artifacts (`.aux`, `.log`, `.out`) are deleted asynchronously after the response is sent.

### Diagnostic Logging

Every relay call appends a JSON line to `logs/pipeline.log`:
```json
{"ts":"2026-06-04T08:12:10.000Z","event":"relay_success","model":"google/gemini-3.5-flash","promptLen":4231,"choices":[...]}
{"ts":"2026-06-04T08:12:10.000Z","event":"relay_fail","model":"cerebras/zai-glm-4.7","error":"...","stack":"..."}
```

The `logs/` directory is created automatically on first request. It is `.gitignore`d.

---

## Test Suites

| Script | Suite | Scope |
|---|---|---|
| `npm test` | unit + mock UI | All mocked tests (server logic, ledger, skills validation, jsdom injection against `tests/mocks/*.html`) |
| `npm run test:live` | `tests/live.test.js` | End-to-end PDF generation against a running server + relay |
| `npm run test:ui-live` | `tests/ui_live.test.js` | Playwright launches real Chromium with the unpacked extension and asserts `#jseek-btn-row` injection on live Greenhouse/Lever job pages; LinkedIn/Indeed are best-effort (bot protection) |

The two live suites are excluded from `npm test` via `vitest.config.js` and opt back in
through the `JSEEK_LIVE=1` env flag set by their npm scripts (vitest's CLI `--exclude`
appends to the config exclude rather than overriding it, so an env flag is required).
Playwright runs headed — Chrome extensions do not load in headless mode.
