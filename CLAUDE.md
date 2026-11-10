# JSeek Enhancer

## Standalone extension (the public product)

The extension runs with no server: users bring their own LLM keys, LaTeX compiles in-browser via WASM pdfTeX, and all state lives in `chrome.storage.local` + IndexedDB. Publishing steps: `docs/publishing.md`.

```bash
npm run build          # dist/chrome + dist/firefox + store zips
npm run build:chrome   # then load dist/chrome unpacked
npm run test:e2e       # builds and drives the real extension in headless Chromium (LLM mocked)
```

- `background.js` handles ops sent over a `jseek` port (`TAILOR`, `COVER_LETTER`, `COLD_MESSAGE`, `COLD_EMAIL`, `CHECK_DUPLICATE`, `GET_PDF`, `IMPORT_RESUME`, `PREVIEW_TEX`, `TEST_KEY`, `STATUS`, …). Callers send keep-alive pings so the MV3 service worker survives 20-40 s LLM calls.
- `pipeline/` is environment-agnostic and shared by the extension and `server.js`: callers inject `callLlm(prompt) → string` and `compile(tex) → { pdf, log }`. Never import `fs`/`child_process` there.
- Chrome compiles in `offscreen.html` (service workers can't start Workers); Firefox's event-page background starts the Worker directly.
- `llm.js`: Anthropic via the vendored official SDK (`vendor/anthropic-sdk.js`, rebuild with `npm run vendor:sdk`), Gemini/Groq/Cerebras via OpenAI-compatible fetch. Keys cascade in user order.
- `vendor/swiftlatex/` is AGPL with one documented patch (fileid fallback). `vendor/texlive/` holds only the TeX files the templates need; regenerate with `scripts/texlive/` (see `docs/publishing.md`).
- The dashboard reads `jobs.json` from GitHub Pages (`FEED_URL` in `dashboard.js`), built by `.github/workflows/feed.yml` → `scripts/build-feed.mjs`.
- No personal data in shipped files: `DEFAULT_PROFILE` is blank and prompts take `candidate = { name, highlights }`.

## Run the local bridge server (optional developer backend)

```bash
npm run dev   # nodemon hot-reload (development)
npm start     # production
```

Server listens on http://localhost:4567

## Environment requirements

- Node >= 20
- `pdflatex` on PATH (install via MacTeX: `brew install --cask mactex` or TeX Live)
- Claude Code CLI on PATH (`claude`) — used when `LLM_PROVIDER=claude`

## Optional env vars (set in `.env` at project root)

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `relay` | `relay` = local RelayFreeLLM gateway; `claude` = Claude CLI subprocess |
| `RELAY_URL` | `http://localhost:8000/v1/chat/completions` | RelayFreeLLM OpenAI-compatible endpoint |
| `RELAY_MODEL` | `google/gemini-3.5-flash` | Primary model for `/tailor` and `/cold-message` |
| `RELAY_CL_MODEL` | `cerebras/zai-glm-4.7` | Primary model for `/cover-letter` |
| `RELAY_DIR` | `/Users/rohanbalasubramanian/Documents/RelayFreeLLM` | Absolute path to cloned RelayFreeLLM repo; auto-spawned at startup |
| `CLAUDE_MODEL` | _(default Sonnet)_ | Override Claude CLI model (e.g., `claude-haiku-4-5-20251001`) |
| `CANDIDATE_NAME` | _(empty)_ | Name used in server-side cover letter / cold-message prompts and PDF filenames |
| `CANDIDATE_HIGHLIGHTS` | _(empty)_ | Experience the server prompts should emphasize (degree, research, key projects) |

See `docs/relay-llm-setup.md` for how to install and configure RelayFreeLLM.
See `docs/routing-hierarchy.md` for the full 19-model cascade priority list.

## Diagnostic log

Every relay call writes a JSON line to `logs/pipeline.log` (created automatically; `.gitignore`d):
- `relay_success`: model, promptLen, raw choices
- `relay_fail`: model, error message, stack trace
- `tailor_request` / `cl_request` / `cold_email_request`: provider, full compiled prompt at request start
- `tailor_llm_output` / `cl_llm_output` / `cold_email_output`: raw LLM output after completion
- `tailor_validation`: per-attempt constraint check results (drives the one-shot LLM retry)
- `tailor_match_score`: ATS keyword coverage score, matched and missing keywords
- `request_complete` / `request_error`: per-request latency breakdown and failures (aggregated by `GET /stats`)

## Server endpoints

- `POST /tailor`, `POST /cover-letter` — PDF generation (serialized by a pipeline mutex; tailor returns `X-JSeek-Match-Score`)
- `POST /cold-message`, `POST /cold-email` — text generation
- `GET /` — local web dashboard (`public/index.html`)
- `GET /health` — status, provider, RelayFreeLLM port check, pdflatex presence
- `GET /api/resume` — serves the last-compiled `resumes/swe.pdf` so the extension can attach it to application forms (404 until `/tailor` runs once)
- `GET /api/jobs?role=&level=&location=&workMode=&h1bOnly=&earlyOnly=&q=&offset=&limit=` — filtered/paginated slice of the job stream (sorted strictly newest-first); `GET /api/job/:id` returns one full posting (lazy-loads the SmartRecruiters description); `POST /api/refresh` triggers a background re-scrape. Stream is built by `jobstream.js` (scrapes ~2,440 boards across Greenhouse/Lever/Ashby/SmartRecruiters/Recruitee + Workday-best-effort from `data/companies.json`, scores them, filters to **last-7-days USA-only tech** via `isUsaOnly`, refreshes every 15 min into `data/jobs_cache.json`). Workday IP-blocks home/datacenter IPs so it often yields nothing — that's expected, not a bug.
- `GET /applications`, `GET /applications/check?company=&title=` — ledger queries (duplicate guard uses a 30-day window)
- `GET /stats` — aggregates from `logs/pipeline.log`

## `resumes/` directory discipline

After a successful request, only these files remain:
- `swe.tex` — master resume template
- `cover_letter_template.tex` — CL template
- `skills_*.txt` — skill pools (4 files)
- `project_pool.tex` — pool of 8 projects for dynamic swapping
- `applied_jobs.json` — local application ledger (`.gitignore`d)

Generated `<Name>_CL_*.tex`, `<Name>_CL_*.pdf` (name from `CANDIDATE_NAME`), and `.aux`/`.log`/`.out` artifacts are deleted asynchronously after the response is sent. The `swe.pdf` artifact from `/tailor` is also cleaned up (only `.aux/.log/.out` — `swe.pdf` itself is kept as the last compiled output).

`/tailor` compiles inside `resumes/build/` (`.gitignore`d) and never modifies the master `swe.tex` — the tailored tex, page-guard spacing adjustments, and pdflatex artifacts all stay in the build sandbox. Tailor and cover-letter requests are serialized by a pipeline mutex.

## Formatting guidelines

- Plain ESM JavaScript (no TypeScript, no bundler) for all extension files
- Express.js for server.js
- Single quotes, 2-space indent, no semicolons
- No comments unless the WHY is non-obvious

For overarching project architecture and file structure, read docs/architecture.md.
