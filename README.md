# JSeek Enhancer

A browser extension (Chrome MV3 + Firefox) that tailors your LaTeX resume and cover letter to the job posting you are viewing. It works on LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby and 12 other platforms, plus any other careers page through an opt-in semantic scraper.

Click **Resume** on a job page. The extension reads the job description, asks your AI provider to choose the matching skills and projects, compiles the PDF **inside your browser** (WebAssembly pdfTeX), scores the ATS keyword match, and saves the file to Downloads in about 30 seconds.

- **No server, no account.** Users bring their own key: Claude (Anthropic API), or free Gemini, Groq or Cerebras keys. Keys are tried in order and fall through on rate limits.
- **Everything stays local.** Keys, resume, profile and application history live in the browser's extension storage.
- **Live job feed.** A dashboard of new US tech postings from about 2,400 company job boards, rebuilt every 30 minutes by GitHub Actions and served from GitHub Pages.

Publishing to the Chrome Web Store and Firefox Add-ons, plus the GitHub Pages setup, is covered in [`docs/publishing.md`](docs/publishing.md).

The original **local server** (`server.js`: pdflatex, Claude CLI, RelayFreeLLM) still works as an optional developer backend, described in section 1 below.

---

## Prerequisites

For **using or building the extension**, all you need is Node.js 20 or newer. The rows below that mention pdflatex, the Claude CLI and RelayFreeLLM apply only to the optional local server.

| Requirement | Install |
|---|---|
| Node.js ≥ 20 | `brew install node` or [nodejs.org](https://nodejs.org) |
| pdflatex on PATH (local server only) | `brew install --cask mactex` (or BasicTeX/TeX Live) |
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
| `GET /api/jobs` | Filtered/paginated slice of the scored job stream (query params: `role, level, location, workMode, h1bOnly, earlyOnly, q, offset, limit`) |
| `GET /api/job/:id` | One full posting (HTML description + score breakdown) for the detail panel |
| `POST /api/refresh` | Triggers a background re-scrape of all company boards |
| `GET /` | The watchlist dashboard (see below) |
| `GET /health` | Provider status, RelayFreeLLM port check, pdflatex presence |
| `GET /applications` | Full application ledger (`resumes/applied_jobs.json`) |
| `GET /applications/check?company=&title=` | Duplicate guard — have I applied here in the last 30 days? |
| `GET /stats` | Latency and model success/fail aggregates from `logs/pipeline.log` |

PDF endpoints are serialized by a pipeline mutex, so concurrent requests queue rather than corrupt the build. `/tailor` compiles inside `resumes/build/` and never modifies the master `swe.tex`.

---

## 2. The Watchlist Dashboard — http://localhost:4567

Open it in any browser while the server runs. It is a dark, jobseek-style watchlist
backed by `jobstream.js`, which scrapes **~2,440 company ATS boards directly** across
six monitor types (Greenhouse/Lever/Ashby/SmartRecruiters/Recruitee JSON APIs +
Workday best-effort, from `data/companies.json`, plus Remotive/Jobicy), scores every
posting, and refreshes every 15 minutes. The stream is filtered to **USA-only tech
roles posted in the last 7 days** and sorted **strictly newest-first**.

**Left column — the job stream.** Scored postings sorted newest-first, with company
logos, H1-B sponsorship badges, relevance scores, and monotonic date dividers
(Today / Yesterday / This Week). Filter chips for **Location, Role, Level, Work Mode**,
plus **H1-B Sponsors Only** and **Early Career** toggles and a keyword search.
"Load more" pages through results; **Refresh** triggers a background re-scrape.

**Right column — detail panel** (opens when you click a job).
- Company logo, job title, and badges (visa signal, role, level, location)
- **Resume / Resume & CL / Message / Email** — the same generation pipeline, run
  against the selected posting (the HTML description is stripped into the JD)
- Score strip — skill / role / visa / recency / company sub-scores
- Collapsible full job description
- Duplicate-application warnings and a live stopwatch during generation

**Header** — last-refreshed time, health line (provider · pdflatex), and **Applied**
/ **Stats** links that open the application ledger (with CSV export) and pipeline stats.

### Scoring (ported from the `myjobs` project)

Each posting scores out of 100: skill-keyword match (35), role priority (25),
visa signal (20), recency (10), and company tier (10), with a 0.35× penalty for
senior-titled roles. Visa signal and role are detected from the description via the
keyword lists in `data/visa_keywords.json` and `data/role_keywords.json`. Scores are
shown on each row but **do not affect ordering** — the stream is sorted strictly by
post time so the date dividers stay monotonic.

### Coverage vs jobseek (what's missing, and why)

jobseek monitors ~4,400 companies across ~33 ATS types. We cover the **6 with clean,
Node-reachable JSON APIs** (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, and
Workday best-effort). The rest can't be fetched from a single Node process without the
infrastructure jobseek runs:

- **Workday** (Cisco, Nvidia, Capital One, Goldman, …) — has a JSON API but **IP-blocks
  datacenter/home IPs** without TLS fingerprinting + rotating proxies, so it frequently
  returns nothing. It's wired in as best-effort; failures are swallowed.
- **`dom` / `sitemap` / `nextdata` / `eightfold` / `oracle_hcm` / `api_sniffer`** (~320
  boards incl. Google, Apple, Amazon, Microsoft, Salesforce, Oracle, Amex, JPMC) — need
  a headless browser and per-site scraper configs.
- **Pinpoint / Workable** — their listing APIs omit a post date, so they can't satisfy
  the strict last-7-days filter (deliberately excluded).

The headline trade-off: **no headless browser and no proxy/TLS-fingerprinting**, which
is what jobseek uses to reach Workday-style and JS-rendered boards. See
`docs/architecture.md` for the full comparison.

---

## 3. The Browser Extension

### Install (Chrome)

```bash
npm run build:chrome
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select `dist/chrome`.
3. The settings page opens on first install:
   - **AI keys:** add a free [Gemini key](https://aistudio.google.com/apikey) and/or an [Anthropic API key](https://console.anthropic.com/settings/keys). A Claude.ai subscription can't be used by third-party apps.
   - **Resume:** paste your resume text and click **Convert to LaTeX**, or paste/upload an existing Jake's-template `.tex`. Preview and save.
   - **Profile:** your contact details and what cover letters should emphasize.
4. After code changes, run `npm run build:chrome` again and click reload on the extension card.

### Install (Firefox)

```bash
npm run build:firefox
```

Then `about:debugging` → This Firefox → Load Temporary Add-on → `dist/firefox/manifest.json`.

### Using the local server instead (developers)

Settings → Advanced → Processing → **My local JSeek server**. Requests then go to `server.js` on port 4567 (pdflatex + Claude CLI/RelayFreeLLM) instead of your API keys. Set `CANDIDATE_NAME` and `CANDIDATE_HIGHLIGHTS` in `.env` to personalize the server's prompts.

### What it does on job pages

On any job posting (18 mapped platforms, or any other site via the universal scraper) it injects a button row:

| Button | Action |
|---|---|
| **Resume** | Tailors and downloads `<First>_<Last>_Resume_<Company>.pdf`, shows match score |
| **Resume & CL** | Both PDFs, staggered to avoid free-tier rate limits |
| **Message** | Copies a recruiter outreach message and opens LinkedIn people search |
| **Email** | Opens a pre-filled `mailto:` cold email |
| **Auto-Fill** | (Greenhouse / Lever / Workday / Ashby / iCIMS / SmartRecruiters / BambooHR / JazzHR / Rippling + LinkedIn Easy Apply) fills ~27 profile fields across text inputs, `<select>` dropdowns, radio groups, and consent checkboxes, and attaches your most recently tailored resume PDF — uses the native value setter + `InputEvent` so React and Workday forms actually register the values. Skips already-filled and blank EEO fields, never auto-submits |

On **jseek.co** it additionally adds H1-B sponsorship badges, an H1-B-sponsors-only filter, an early-career seniority filter, per-company LinkedIn recruiter icons, and an LLM provider toggle.

**Universal scraper (opt-in):** after you enable "every careers page" in settings, on hosts not in the 18 mapped platforms the extension scores every content block by text density and JD-keyword presence (requirements, responsibilities, qualifications, …) and injects above the best candidate. On non-job pages nothing scores, so nothing is injected.

**Your profile** (used by Auto-Fill, the resume header and cover letters) lives on the settings page. Blank fields are never auto-filled.

---

## 4. Tests

```bash
npm test              # full unit suite — mocked, fast, no network
npm run test:ui       # content-script injection against local HTML mocks (jsdom)
npm run test:live     # end-to-end PDF generation against a RUNNING server + relay
npm run test:ui-live  # REAL browser: Playwright loads the unpacked extension and
                      # asserts button injection on live Greenhouse/Lever job pages
npm run test:e2e      # builds dist/chrome, loads it headless in Chromium, and runs the
                      # real service worker → offscreen → WASM pdfTeX pipeline with
                      # mocked LLM responses (no key or network quota needed)
```

`test:live` and `test:ui-live` are excluded from `npm test` (they need a live server / a real browser) and opt in via the `JSEEK_LIVE=1` env flag set by their scripts. `test:ui-live` opens a visible Chromium window — extensions don't load headless.

---

## 5. Project Structure

```
background.js              Service worker: routes ops to the pipeline, WASM compile, storage, batch apply
content_script.js          On-page buttons, scraping, auto-fill (talks to background over a port)
options.html/.js/.css      Onboarding: AI keys, resume import/preview, profile, advanced
dashboard.html/.js/.css    Job feed dashboard (reads the GitHub Pages feed)
offscreen.html/.js         Hosts the pdfTeX Worker (Chrome MV3 service workers can't)
tex-engine.js              Wrapper around the vendored SwiftLaTeX pdfTeX worker
llm.js                     BYOK LLM client: Anthropic SDK + OpenAI-compatible free providers, cascade
store.js / bridge.js       chrome.storage + IndexedDB helpers / port client for extension pages
pipeline/                  Environment-agnostic logic shared by extension and server:
                           prompts, tailor/cover-letter orchestration, LaTeX graft/sanitize,
                           skills validation, match score, template fill, job-feed filters
templates/                 Generic Jake's-template resume, cover letter, sample project pool
vendor/                    anthropic-sdk.js (esbuild bundle), swiftlatex/ (AGPL engine, patched),
                           texlive/ (77 TeX files + prebuilt format)
site/                      GitHub Pages landing page + privacy policy
scripts/                   build-extension, build-feed, store-screenshots, texlive/ format builder
.github/workflows/feed.yml Scheduled job-feed build → GitHub Pages
server.js                  Optional local backend (pdflatex, Claude CLI / RelayFreeLLM)
jobstream.js               Company-board scraper + scorer (used by server and feed build)
public/index.html          Local-server version of the dashboard
data/                      companies.json (ATS board tokens), visa/role keyword lists
resumes/                   Local-server master resume, templates, pools, ledger
tests/                     Unit, mock-UI, live, and Playwright suites (incl. extension E2E)
docs/                      architecture.md, publishing.md, workflow.md, relay setup
```

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Buttons greyed out, "add an API key" / "import your resume" tooltip | Finish the three setup steps on the settings page |
| "All configured LLM keys failed" | Use **Test** next to each key on the settings page; free tiers hit daily quotas, so add a second provider |
| Buttons greyed out in local-server mode | Start the server: `npm start` |
| `pdflatex: MISSING` on dashboard health line | Install MacTeX; restart the server so PATH is re-resolved |
| Relay errors / all models failing | Check `logs/relay.log` and `GET /stats`; see `docs/routing-hierarchy.md` |
| Resume PDF overflows one page | The server auto-tightens spacing (5 attempts); check `logs/pipeline.log` if it still fails |
| Extension not injecting after update | Reload the extension at `chrome://extensions` — new permissions need re-approval |
| LaTeX compile error in alert | The error message includes the offending line number from pdflatex |

Deep dives: `docs/architecture.md` (system design), `CLAUDE.md` (ops runbook), `docs/routing-hierarchy.md` (19-model LLM cascade).
