# JSeek Enhancer — Architecture

## Overview

```
┌──────────────────────────────────────────────────────┐
│                  Chrome Browser                       │
│                                                       │
│   jseek.co tab                                        │
│   ┌─────────────────────────────────────────────┐    │
│   │  content_script.js                          │    │
│   │  • Injects UI (buttons, badges, toggles)    │    │
│   │  • Scrapes job descriptions from DOM        │    │
│   │  • Reads h1b_data.json (bundled asset)      │    │
│   │  • POSTs to localhost:4567/tailor           │    │
│   │  • Sends DOWNLOAD_PDF message → background  │    │
│   └──────────────┬──────────────────────────────┘    │
│                  │ chrome.runtime.sendMessage         │
│   ┌──────────────▼──────────────────────────────┐    │
│   │  background.js (Service Worker)             │    │
│   │  • Listens for DOWNLOAD_PDF                 │    │
│   │  • Calls chrome.downloads.download()        │    │
│   └─────────────────────────────────────────────┘    │
└────────────────────┬─────────────────────────────────┘
                     │ HTTP POST /tailor
                     │ (application/json)
┌────────────────────▼─────────────────────────────────┐
│              server.js  (Express, port 4567)          │
│                                                       │
│  POST /tailor                                         │
│    1. Write jobDescription → resumes/current_job.txt  │
│    2. Build Claude prompt string                      │
│    3. execFile(claudePath, ['-p', prompt])            │
│    4. execFile('pdflatex', [..., 'resumes/swe.tex'])  │
│    5. Read resumes/swe.pdf → pipe as application/pdf  │
│                                                       │
│  GET /health  → 200 OK                               │
└───────────┬───────────────────────────────────────────┘
            │
     ┌──────▼────────┐      ┌────────────────────────┐
     │  Claude CLI   │      │  pdflatex              │
     │  (claude -p)  │      │  (TeX Live / MacTeX)   │
     └──────┬────────┘      └────────────┬───────────┘
            │ reads/writes               │ reads/writes
     ┌──────▼────────────────────────────▼───────────┐
     │  resumes/                                      │
     │  ├── swe.tex          ← master LaTeX template  │
     │  ├── current_job.txt  ← written at runtime     │
     │  ├── swe.pdf          ← compiled output        │
     │  ├── skills_ds.txt                             │
     │  ├── skills_ml.txt                             │
     │  ├── skills_cloud.txt                          │
     │  └── skills_network.txt                        │
     └────────────────────────────────────────────────┘
```

---

## File Responsibilities

| File | Responsibility |
|---|---|
| `manifest.json` | Chrome extension manifest V3 — permissions, host rules, script declarations |
| `content_script.js` | All DOM interaction: button/badge/toggle injection, JD scraping, fetch to server |
| `background.js` | Service worker — handles `chrome.downloads.download()` on behalf of content script |
| `server.js` | Express bridge — `/tailor` endpoint, Claude CLI invocation, pdflatex compilation |
| `package.json` | Node server dependencies and run scripts |
| `h1b_data.json` | Static company → H1-B sponsorship count lookup, loaded by content script |
| `docs/architecture.md` | This file |
| `CLAUDE.md` | Ops runbook for Claude Code sessions |

---

## System Data Flows

### Feature 1 — LaTeX Resume Tailor

```
User clicks [ Tailor Resume ] on a jseek.co job page
  → content_script.js scrapes innerText of job description container
  → POST http://localhost:4567/tailor  { jobDescription: "..." }
  → server.js writes resumes/current_job.txt
  → server.js spawns: claude -p "<prompt>"
      Claude reads swe.tex + current_job.txt + skills_*.txt
      Claude overwrites swe.tex with tailored skills section
  → server.js spawns: pdflatex -output-directory=resumes resumes/swe.tex
  → server.js reads resumes/swe.pdf → responds with application/pdf binary
  → content_script.js creates blob URL → sends DOWNLOAD_PDF to background.js
  → background.js calls chrome.downloads.download({ url, filename: 'swe.pdf' })
  → PDF saved to user's Downloads folder
```

### Feature 2 — Enhanced Seniority Filter

```
User visits jseek.co watchlist page
  → content_script.js injects "Enhanced Early Career" toggle into filter sidebar
User clicks toggle ON
  → content_script.js queries all job title elements
  → Hides titles matching /senior|lead|staff/i
  → Shows/highlights titles matching /associate|junior|\bII\b|0-3 years|grad|entry/i
User clicks toggle OFF
  → Restores original display values
```

### Feature 3 — H1-B Sponsorship Badge & Filter

```
Page load on jseek.co
  → content_script.js fetches h1b_data.json via chrome.runtime.getURL()
  → For each company card: looks up count in h1b_data, injects "H1-B: N sponsored" badge
  → Injects "H1-B Sponsors Only" toggle into filter sidebar
User clicks "H1-B Sponsors Only" ON
  → Hides company cards with sponsorship count < 50 (H1B_THRESHOLD constant)
```

### Feature 4 — LinkedIn Recruiter Finder

```
content_script.js runs on jseek.co
  → Finds company name elements in job cards
  → Injects LinkedIn SVG icon button after each company name
User clicks icon
  → Opens new tab:
    https://www.linkedin.com/search/results/people/?keywords=recruiter%20AND%20"<company>"
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
| Job title show regex | `/associate|junior|\bII\b|0-3 years|grad|entry/i` | `content_script.js` |
| Job title hide regex | `/senior|lead|staff/i` | `content_script.js` |

---

## Manifest Permissions Rationale

| Permission | Why |
|---|---|
| `activeTab` | Read DOM of the currently active jseek.co tab |
| `downloads` | Trigger PDF download to user's Downloads folder |
| `storage` | Persist toggle states across page navigations |
| `host_permissions: localhost:4567` | Allow content script to POST to the local bridge server |
| `host_permissions: jseek.co` | Allow content script injection on the target site |
| `web_accessible_resources: h1b_data.json` | Allow content script to load the bundled JSON via `chrome.runtime.getURL` |
