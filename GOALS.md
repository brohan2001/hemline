# Phase 3 Goals

## Tasks

- [x] Step 1: Git init + .gitignore hygiene
- [x] Step 2: GOALS.md task board
- [x] Step 3: Vitest + Supertest test infrastructure
- [x] Step 4: Performance timer on Resume and Resume+CL buttons
- [x] Step 5: Multi-site SITE_CONFIGS (LinkedIn + Jobright)
- [x] Step 6: Cold Message endpoint + Message button
- [x] Step 7: Application Tracker Ledger (applied_jobs.json)

## Success Definition

All Phase 3 tasks above are checked. Additionally:
- `npm test` passes with all tests green
- Extension loads without errors on jseek.co, linkedin.com, and jobright.ai
- Resume/CL buttons show elapsed time during generation and final time on completion
- Message button copies text to clipboard and opens LinkedIn recruiter search tab
- After each /tailor or /cover-letter call, resumes/applied_jobs.json is updated with the new entry

## Instructions for Updates

Mark each task `[x]` as soon as its feature is implemented and committed. This file is the
single source of truth for Phase 3 progress. Do not mark a task done until its associated
`git commit` has been made.

---

# Phase 4 Goals

## Tasks

- [x] Step 1: Purge Ollama — delete Modelfile, rename `callOllama` → `callRelay`, swap `OLLAMA_*` env vars to `RELAY_*`
- [x] Step 2: Auto-spawn relay — `maybeSpawnRelay()` with TCP port 8000 probe at server startup
- [x] Step 3: Update unit tests — swap `ollama` → `relay` provider references in `tests/server.test.js`
- [x] Step 4: Live integration test suite — `tests/live.test.js` + `test:live` script in `package.json`
- [x] Step 5: Docs refresh — `docs/relay-llm-setup.md` (replaces local-llm-setup.md), `docs/my-customizations.md` (new), `docs/architecture.md` updated, `CLAUDE.md` env vars updated

## Success Definition

- `npm test` passes with all tests green (relay provider label)
- `npm run dev` auto-spawns RelayFreeLLM when `LLM_PROVIDER=relay` and port 8000 is free
- `npm run test:live` passes all 3 live tests against a running server + relay (end-to-end PDF generation)
- `resumes/swe.pdf` and `resumes/Rohan_CL_*.pdf` are valid PDFs (start with `%PDF` magic bytes)
- No Ollama references remain in source code

---

# Phase 5 Goals

## Tasks

- [x] Step 1: 19-model relay cascade — implemented server-side in RelayFreeLLM `model_dispatcher.py` + `model_selector.py` (INTENT_HIERARCHY); Node makes single-call per request, RelayFreeLLM handles all fallbacks transparently
- [x] Step 2: Separate cover-letter model — `RELAY_CL_MODEL` env var (default: `cerebras/zai-glm-4.7`) as primary for `/cover-letter`; `callRelay(prompt, primaryModel)` signature
- [x] Step 3: Production auto-trimmer — `trimToWord` + `visibleLength` + `applySkillsLineTrimmer` clamps skill rows 2–4 to ≤105 visible chars before writing swe.tex
- [x] Step 4: Cover letter disk cleanup — generated `Rohan_CL_*.tex` and `Rohan_CL_*.pdf` deleted asynchronously after PDF is sent
- [x] Step 5: Browser-side request staggering — 1-second delay between `/tailor` and `/cover-letter` in the "Resume & CL" click handler; timer label switches from "Tailoring…" to "Writing CL…"

## Success Definition

- Stdout shows only clean `[/tailor]`, `[/cover-letter]`, and `[Relay] model -> Success/Failed` lines — no debug banners
- `logs/pipeline.log` captures full prompt length, raw choices JSON, and error traces on every request
- After "Resume & CL" click: `/tailor` fires, 1s elapses, `/cover-letter` fires (no concurrent 429s)
- `resumes/` contains only `swe.tex`, `cover_letter_template.tex`, and `skills_*.txt` after a successful CL generation
- swe.tex skill rows 2–4 never exceed 105 visible characters after the trimmer runs

---

# Phase 6 Goals

## Tasks

- [x] Step 1: Clean diagnostic log — `logs/pipeline.log` permanent file with prompt lengths, raw API choices, error traces on every request
- [x] Step 2: `logs/` added to .gitignore; created automatically at first request via `fs.mkdir({ recursive: true })`
- [x] Step 3: `docs/routing-hierarchy.md` — full 19-model INTENT_HIERARCHY list with providers, tiers, cascade mechanics, and circuit breaker behavior
- [x] Step 4: `docs/architecture.md` rewrite — full system diagram (Extension → Node → RelayFreeLLM → 19-model cascade → Provider APIs), all 6 features, LLM routing, env vars, resumes/ discipline
- [x] Step 5: `CLAUDE.md` update — `RELAY_MODEL`/`RELAY_CL_MODEL` env vars, diagnostic log docs, resumes/ cleanup behavior

## Success Definition

- `docs/architecture.md` accurately reflects the current 3-endpoint server, RelayFreeLLM auto-spawn, and cascade routing
- `docs/routing-hierarchy.md` lists all 19 models with providers, tiers, and rationale
- `CLAUDE.md` is the complete ops runbook needed to configure and run the system from scratch
- No obsolete documentation files remain in `docs/`
- `npm test` passes with all 64 tests green
