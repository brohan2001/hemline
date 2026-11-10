# Hemline — Architecture

## Standalone extension (public build)

```
content_script.js / dashboard.js / options.js
        │  chrome.runtime.connect('hemline') + keep-alive pings
        ▼
background.js (MV3 service worker; Firefox: event page)
  ├─ pipeline/tailor.js   tailorResume / writeCoverLetter / writeColdMessage / writeColdEmail
  │     callLlm ──► llm.js ──► Anthropic SDK | Gemini | Groq | Cerebras   (user's keys, cascade)
  │     compile ──► offscreen.html ──► tex-engine.js ──► SwiftLaTeX pdfTeX Worker (WASM)
  │                                                    └─ vendor/texlive/pdftex/<fmt>/<file>
  ├─ store.js             chrome.storage.local (keys, resume, profile, ledger) + IndexedDB (PDFs)
  └─ chrome.downloads     <First>_<Last>_Resume_<Company>.pdf

dashboard.js ──► https://brohan2001.github.io/hemline/jobs.json (+ details/<shard>.json)
                   ▲ .github/workflows/feed.yml → scripts/build-feed.mjs → jobstream.js
```

`server.js` uses the same `pipeline/` modules with pdflatex and the Claude CLI or RelayFreeLLM injected, so both backends produce identical tailoring logic. The diagram below describes that local-server path. Publishing steps are in `docs/publishing.md`.

## Overview (local server)

```
┌──────────────────────────────────────────────────────┐
│                  Chrome Browser                       │
│                                                       │
│   any job page (18 mapped platforms + universal)      │
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
│  GET  /api/jobs       → scored stream slice (filters) │
│  GET  /api/job/:id    → full posting for detail panel │
│  POST /api/refresh    → trigger background re-scrape   │
│  GET  /               → watchlist dashboard           │
│  GET  /health         → provider + pdflatex status    │
│  GET  /api/resume     → last-compiled swe.pdf (upload)│
│  GET  /applications   → ledger (+ /check dup guard)   │
│  GET  /stats          → pipeline.log aggregates       │
│  jobstream.js → ~2,300 ATS boards, scored, USA-tech   │
│                                                       │
│  LLM routing:                                         │
│    provider = req.body.provider || LLM_PROVIDER       │
│    relay  → callRelay(prompt, primaryModel)           │
│    claude → runClaude(bin, prompt, cwd)               │
│                                                       │
│  After /cover-letter PDF is sent:                     │
│    <Name>_CL_*.tex + .pdf deleted async               │
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
| `server.js` | Express bridge — all LLM endpoints, pdflatex compilation, relay routing, job-stream routes |
| `jobstream.js` | Company-board scraper + scorer — fetches/normalizes/scores the in-memory job stream (15-min background refresh) |
| `data/companies.json` | ~2,300 companies × Greenhouse/Lever/Ashby board tokens (derived from the `myjobs` project) |
| `data/visa_keywords.json` / `data/role_keywords.json` | Visa-signal and role-classification keyword lists (ported from `myjobs`) |
| `package.json` | Node server dependencies and run scripts |
| `h1b_data.json` | Static company → H1-B sponsorship count lookup, loaded by content script |
| `site_configs.js` | Per-site DOM selector configs for 18 job boards + `universal` runtime fallback |
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
  → writes <Name>_CL_{safe}.tex
  → pdflatex compiles → <Name>_CL_{safe}.pdf
  → server reads PDF → sends application/pdf
  → AFTER res.send(): <Name>_CL_*.tex and .pdf deleted asynchronously
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

### Feature 7 — Company-Board Job Stream + Watchlist Dashboard (`jobstream.js`)

The stream scrapes ~2,440 company ATS boards directly across 6 monitor types, scores
every posting, filters to **last-7-days USA-only tech**, and serves a jobseek-style
watchlist UI. Company+board config lives in `data/companies.json` (derived from the
`myjobs` project); scoring/visa/role keyword logic is ported from `myjobs/src/ranker.py`.

Monitor types & description handling:
- `greenhouse`, `lever`, `ashby`, `recruitee` — full description in the listing
- `smartrecruiters` — listing has an ISO country code (clean USA filter); the body is
  fetched lazily on `GET /api/job/:id` via `loadDetail()`
- `workday` — list carries a relative post date; recent postings are detail-fetched for
  description + real location. **Best-effort**: Workday IP-blocks datacenter/home IPs
  without TLS fingerprinting, so it often yields nothing (see compromises below)

```
Server startup (isMain)
  → initStream(): load data/{companies,visa_keywords,role_keywords}.json + h1b_data.json
  → load data/jobs_cache.json into memory if present (warm start)
  → refresh() in the background, then setInterval(refresh, 15min)

refresh()  (jobstream.js — bounded to 20 concurrent fetches)
  → for each company board: fetchGreenhouse|Lever|Ashby|Workday|SmartRecruiters|Recruitee
    (+ Remotive + Jobicy as remote-only supplements)
  → normalize(): classifyRole, detectVisa, detectLevel, parseMaxExperience,
    scoreJob (skill 35 / role 25 / visa 20 / recency 10 / company 10, senior ×0.35)
  → drop jobs older than 7 days (or undated), non-USA (isUsaOnly — India/foreign
    excluded), and non-tech (role 'other' + low skill)
  → dedupe on url, SORT STRICTLY BY postedAt DESC (newest first), keep top
    MAX_JOBS (20000), persist to cache

GET /api/jobs?role=&level=&location=&workMode=&h1bOnly=&earlyOnly=&q=&offset=&limit=
  → queryJobs() filters the in-memory stream, returns a lightweight page
    { total, count, offset, jobs:[…], streamTotal, lastRefreshed, refreshing }
GET /api/job/:id   → full posting (HTML description + score breakdown) for the panel
POST /api/refresh  → triggers a background refresh

Dashboard (public/index.html — dark watchlist UI)
  → filter chips (location/role/level/work mode) + H1-B-only + Early-career toggles
  → job rows: company logo (clearbit), H1-B badge, title, score, time-ago, date dividers
  → click a row → GET /api/job/:id → detail panel with visa/role/level badges,
    score strip, and the Resume / Resume&CL / Message / Email actions
  → Tailor actions strip the HTML description and POST to /tailor, /cover-letter, etc.
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

### Feature 9 — ATS Auto-Fill (9 ATS platforms + LinkedIn Easy Apply)

ATS_SLUGS: Greenhouse, Lever, Workday, Ashby, iCIMS, SmartRecruiters, BambooHR,
JazzHR, Rippling. LinkedIn Easy Apply is handled separately (modal observer).

```
User clicks [ Auto-Fill ] above the application form
  → autoFillForm(root) matches each empty field by name/id/placeholder/
    aria-label/data-automation-id/label against FIELD_PATTERNS (~27 fields)
  → text/textarea: setFieldValue() — native prototype value setter (bypasses
      React's fiber shim) + InputEvent { bubbles, composed } (crosses Workday
      shadow DOM) + change event → frameworks register the value as user input
  → <select>: setSelectValue() — fuzzy-matches profile value to an option
  → radios: fillRadioGroup() — picks the option matching the profile value
  → checkboxes: only auto-checks consent/terms boxes, never demographic ones
  → file inputs: fillResumeUpload() fetches GET /api/resume (swe.pdf) and
      injects it via DataTransfer (the only way to set input.files in JS)
  → after a fill, highlightNextButton() outlines the multi-step Next/Continue
      button (never auto-submits)
  → blank fields (e.g. EEO gender/race/veteran) are skipped unless the user
      filled them in the options page
  → profile from chrome.storage (options page) or DEFAULT_PROFILE fallback

LinkedIn Easy Apply (cfg.slug === 'linkedin'):
  → watchLinkedInEasyApply() installs a MutationObserver (guarded once per page)
  → when the [class*="jobs-easy-apply-modal"] modal appears, debounce 400ms then
      autoFillForm(modal) scoped to the modal, then highlight its Next button
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

Generated `<Name>_CL_*.tex`, `<Name>_CL_*.pdf` (name from `CANDIDATE_NAME`), and pdflatex artifacts (`.aux`, `.log`, `.out`) are deleted asynchronously after the response is sent.

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
| `npm run test:ui-live` | `tests/ui_live.test.js` | Playwright launches real Chromium with the unpacked extension and asserts `#hemline-btn-row` injection on live Greenhouse/Lever job pages; LinkedIn/Indeed are best-effort (bot protection) |

The two live suites are excluded from `npm test` via `vitest.config.js` and opt back in
through the `HEMLINE_LIVE=1` env flag set by their npm scripts (vitest's CLI `--exclude`
appends to the config exclude rather than overriding it, so an env flag is required).
Playwright runs headed — Chrome extensions do not load in headless mode.
