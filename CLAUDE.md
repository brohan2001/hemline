# JSeek Enhancer

## Run the local bridge server

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

See `docs/relay-llm-setup.md` for how to install and configure RelayFreeLLM.
See `docs/routing-hierarchy.md` for the full 19-model cascade priority list.

## Diagnostic log

Every relay call writes a JSON line to `logs/pipeline.log` (created automatically; `.gitignore`d):
- `relay_success`: model, promptLen, raw choices
- `relay_fail`: model, error message, stack trace
- `tailor_request` / `cl_request` / `cold_email_request`: provider, full compiled prompt at request start
- `tailor_llm_output` / `cl_llm_output` / `cold_email_output`: raw LLM output after completion

## `resumes/` directory discipline

After a successful request, only these files remain:
- `swe.tex` — master resume template
- `cover_letter_template.tex` — CL template
- `skills_*.txt` — skill pools (4 files)
- `project_pool.tex` — pool of 8 projects for dynamic swapping
- `applied_jobs.json` — local application ledger (`.gitignore`d)

Generated `Rohan_CL_*.tex`, `Rohan_CL_*.pdf`, and `.aux`/`.log`/`.out` artifacts are deleted asynchronously after the response is sent. The `swe.pdf` artifact from `/tailor` is also cleaned up (only `.aux/.log/.out` — `swe.pdf` itself is kept as the last compiled output).

`/tailor` compiles inside `resumes/build/` (`.gitignore`d) and never modifies the master `swe.tex` — the tailored tex, page-guard spacing adjustments, and pdflatex artifacts all stay in the build sandbox. Tailor and cover-letter requests are serialized by a pipeline mutex.

## Formatting guidelines

- Plain ESM JavaScript (no TypeScript, no bundler) for all extension files
- Express.js for server.js
- Single quotes, 2-space indent, no semicolons
- No comments unless the WHY is non-obvious

For overarching project architecture and file structure, read docs/architecture.md.
