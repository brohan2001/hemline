# JSeek Enhancer

A personal job-application automation system with two halves:

1. **A browser extension** (Chrome MV3 + Firefox) that injects action buttons directly into job postings — on LinkedIn, Indeed, Greenhouse, Lever, Workday, and 7 other platforms, plus *any* unmapped careers page via a heuristic semantic scraper.
2. **A local bridge server** (Express, port 4567) that does the heavy lifting the browser can't: calling LLMs, compiling LaTeX resumes to PDF, tracking applications, and aggregating live job feeds.

Click **Resume** on any job page → the extension scrapes the job description → the server tailors your master LaTeX resume to the JD with an LLM, compiles it with pdflatex, scores the ATS keyword match, and the PDF lands in your Downloads folder — typically in under 30 seconds.

---

## Prerequisites

| Requirement | Install |
|---|---|
| Node.js ≥ 20 | `brew install node` or [nodejs.org](https://nodejs.org) |
| pdflatex on PATH | `brew install --cask mactex` (or BasicTeX/TeX Live) |
| Claude Code CLI (optional) | Only needed when `LLM_PROVIDER=claude` |
| RelayFreeLLM (optional) | Free-tier LLM gateway — see `docs/relay-llm-setup.md` |

```bash
git clone https://github.com/brohan2001/resume-extension.git
cd resume-extension
npm install
```

For the live Playwright test suite (one-time):

```bash
npx playwright install chromium
```

---

## 1. The Server — what it does and how to run it

The server is the bridge between the browser and your local toolchain. Browsers can't run pdflatex, spawn LLM subprocesses, or keep a persistent application ledger — the server does all of that. Nothing leaves your machine except the LLM API calls themselves.

```bash
npm run dev    # development — nodemon hot-reload
npm start      # production
```

It listens on **http://localhost:4567**. On startup it auto-spawns the RelayFreeLLM gateway (port 8000) if `LLM_PROVIDER=relay` and the port is free.

### Configuration (`.env` at project root)

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `relay` | `relay` = local RelayFreeLLM gateway; `claude` = Claude CLI subprocess |
| `RELAY_URL` | `http://localhost:8000/v1/chat/completions` | RelayFreeLLM endpoint |
| `RELAY_MODEL` | `google/gemini-3.5-flash` | Primary model for `/tailor` and `/cold-message` |
| `RELAY_CL_MODEL` | `cerebras/zai-glm-4.7` | Primary model for `/cover-letter` |
| `RELAY_DIR` | `~/Documents/RelayFreeLLM` | RelayFreeLLM repo path for auto-spawn |
| `CLAUDE_MODEL` | _(default Sonnet)_ | Override Claude CLI model |

### Endpoints

| Endpoint | What it does |
|---|---|
| `POST /tailor` | Tailors `resumes/swe.tex` to a JD, compiles PDF, returns it with `X-JSeek-Match-Score` ATS header |
| `POST /cover-letter` | Generates a 3-paragraph cover letter PDF from the template |
| `POST /cold-message` | Returns a <300-char LinkedIn connection message |
| `POST /cold-email` | Returns `{ subject, body }` for a recruiter cold email |
| `GET /api/jobs` | Live job stream — aggregates Arbeitnow, Remotive, and Jobicy free APIs, deduplicated |
| `GET /` | The local web dashboard (see below) |
| `GET /health` | Provider status, RelayFreeLLM port check, pdflatex presence |
| `GET /applications` | Full application ledger (`resumes/applied_jobs.json`) |
| `GET /applications/check?company=&title=` | Duplicate guard — have I applied here in the last 30 days? |
| `GET /stats` | Latency and model success/fail aggregates from `logs/pipeline.log` |

PDF endpoints are serialized by a pipeline mutex, so concurrent requests queue rather than corrupt the build. `/tailor` compiles inside `resumes/build/` and never modifies the master `swe.tex`.

---

## 2. The Local Dashboard — http://localhost:4567

Open it in any browser while the server runs. It is a two-column workspace:

**Left column — live job stream.** Auto-loads ~150 active tech jobs from three free public APIs (Arbeitnow, Remotive, Jobicy). Filter by keyword, hit Refresh for a fresh pull. **Click any job card and its description, company, and title instantly populate the right panel** — no copy-pasting.

**Right column — tailoring panel.**
- Paste (or click-load) a job description, company, and title
- **Tailor Resume** — downloads the tailored PDF, shows the ATS keyword match %
- **Tailor Cover Letter** — downloads the CL PDF
- **Generate Cold Message** — LinkedIn outreach text with one-click copy
- Live stopwatch during generation, duplicate-application warnings
- **Applications panel** — searchable ledger of everything you've applied to, with CSV export
- **Stats panel** — request latencies and per-model success/fail counts
- Health line — provider, RelayFreeLLM, and pdflatex status at a glance

---

## 3. The Browser Extension

### Install (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this project's root folder
4. After pulling updates, hit the reload icon on the extension card

### Install (Firefox)

```bash
npm run build:firefox
```

Then `about:debugging` → This Firefox → Load Temporary Add-on → `dist/firefox/manifest.json`.

### What it does on job pages

On any job posting (12 mapped platforms, or any other site via the universal scraper) it injects a button row:

| Button | Action |
|---|---|
| **Resume** | Tailors and downloads `Rohan_Resume_<Company>.pdf`, shows match score |
| **Resume & CL** | Both PDFs, staggered to avoid free-tier rate limits |
| **Message** | Copies a recruiter outreach message and opens LinkedIn people search |
| **Email** | Opens a pre-filled `mailto:` cold email |
| **Auto-Fill** | (Greenhouse / Lever / Workday) fills name, email, phone, LinkedIn, GitHub, skills into application forms — uses the native value setter + `InputEvent` so React and Workday forms actually register the values |

On **jseek.co** it additionally adds H1-B sponsorship badges, an H1-B-sponsors-only filter, an early-career seniority filter, per-company LinkedIn recruiter icons, and an LLM provider toggle.

**Universal scraper:** on hosts not in the 12 mapped platforms, the extension scores every content block by text density and JD-keyword presence (requirements, responsibilities, qualifications, …) and injects above the best candidate. On non-job pages nothing scores, so nothing is injected.

**Your profile** (used by Auto-Fill) is editable in the extension's options page; it defaults to the values in `content_script.js`.

---

## 4. Tests

```bash
npm test              # full unit suite — mocked, fast, no network
npm run test:ui       # content-script injection against local HTML mocks (jsdom)
npm run test:live     # end-to-end PDF generation against a RUNNING server + relay
npm run test:ui-live  # REAL browser: Playwright loads the unpacked extension and
                      # asserts button injection on live Greenhouse/Lever job pages
```

`test:live` and `test:ui-live` are excluded from `npm test` (they need a live server / a real browser) and opt in via the `JSEEK_LIVE=1` env flag set by their scripts. `test:ui-live` opens a visible Chromium window — extensions don't load headless.

---

## 5. Project Structure

```
server.js                  Express bridge — LLM calls, pdflatex, ledger, job stream
public/index.html          The local dashboard (single file)
content_script.js          Extension UI injection, scraping, auto-fill
site_configs.js            Per-platform DOM selectors + universal fallback
background.js              Service worker — PDF downloads
manifest.json              Chrome MV3 manifest (manifest_firefox.json for FF)
options.html / options.js  Extension profile editor
h1b_data.json              Company → H1-B sponsorship counts
resumes/                   swe.tex master, CL template, skill pools, project pool,
                           applied_jobs.json ledger, build/ sandbox
tests/                     Unit, mock-UI, live, and Playwright suites
docs/                      architecture.md, routing-hierarchy.md, relay setup, customizations
logs/pipeline.log          JSON-line diagnostics for every request (gitignored)
```

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Buttons greyed out, "server offline" tooltip | Start the server: `npm start` |
| `pdflatex: MISSING` on dashboard health line | Install MacTeX; restart the server so PATH is re-resolved |
| Relay errors / all models failing | Check `logs/relay.log` and `GET /stats`; see `docs/routing-hierarchy.md` |
| Resume PDF overflows one page | The server auto-tightens spacing (5 attempts); check `logs/pipeline.log` if it still fails |
| Extension not injecting after update | Reload the extension at `chrome://extensions` — new permissions need re-approval |
| LaTeX compile error in alert | The error message includes the offending line number from pdflatex |

Deep dives: `docs/architecture.md` (system design), `CLAUDE.md` (ops runbook), `docs/routing-hierarchy.md` (19-model LLM cascade).
