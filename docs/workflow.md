# Daily Job Application Workflow

A step-by-step guide to using every feature of the Hemline system. Follow this top-to-bottom each day.

---

## Step 0 — One-time setup (first day only)

### 1. Start the server (keep this terminal tab open all day)

```bash
cd ~/Documents/hemline
npm start
```

Visit **http://localhost:4567** — you should see the dashboard. The health line at the top should read all green: provider, pdflatex, and RelayFreeLLM. If pdflatex is missing, install MacTeX (`brew install --cask mactex`) and restart.

### 2. Load the extension in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** → select `~/Documents/hemline`

After any code update: hit the reload ↻ icon on the extension card.

### 3. Fill in your Auto-Fill profile

Click the extension icon → **Options** (or right-click → Options).

Fill in every section:
- Name, email, phone, LinkedIn, GitHub
- City, State, Zip, Country
- Work Authorization (e.g. F-1 OPT), Require Sponsorship (Yes)
- Years of experience, Start date
- Education level, University, Major, Graduation year, GPA
- Salary range
- EEO fields (optional — leave blank to skip)

Save. The Auto-Fill button on ATS forms will use these values instead of the hardcoded defaults.

---

## Step 1 — Morning: discover jobs (~15 minutes)

### A. Watchlist dashboard

Open **http://localhost:4567** in a tab. The left column is a scored, USA-filtered
stream pulled from ~2,300 company ATS boards (Greenhouse/Lever/Ashby), refreshed
every 15 minutes. Each row shows the company logo, an H1-B badge, a relevance score,
and how long ago it was posted, grouped by Today / Yesterday / This Week / Earlier.

- Filter chips: **Location, Role, Level, Work Mode**, plus **H1-B Sponsors Only** and
  **Early Career** toggles, and a keyword search
- **Refresh** kicks off a background re-scrape; **Load more** pages through results
- Click any row → the detail panel opens with visa/role/level badges, a score
  breakdown, the full description, and the Resume / Resume & CL / Message / Email
  buttons wired to that exact posting

### B. jseek.co (your curated watchlist)

Go to **jseek.co** and open your watchlist. The extension injects:
- **H1-B: N sponsored** badge on every company card — green if ≥ 50 sponsorships, red if < 50
- **H1-B Sponsors Only** toggle — click it to hide companies with < 50 H1-B sponsorships
- **Enhanced Early Career** toggle — hides Senior/Lead/Staff titles, highlights Associate/Junior/Graduate/Entry-level ones
- **LinkedIn icon** next to every company name — click it to open a recruiter search for that company in a new tab

Use the H1-B and seniority filters together to quickly cut your list to companies that will actually sponsor and that have roles at your level.

### C. LinkedIn / other job boards

Browse normally. The extension runs on LinkedIn, Indeed, Glassdoor, Jobright, BuiltIn, WellFound, Dice, ZipRecruiter, and *any* other careers page via the universal scraper. On any job posting you'll see the Hemline button row injected above the description.

---

## Step 2 — Evaluating a job

When you land on a job page and see the Hemline button row, assess it before applying:

1. **Do the H1-B badge and seniority match?** Already answered on jseek.co — or check the company name against your h1b_data.json knowledge.
2. **Is the JD worth tailoring?** Skim it. If it's a stretch or a clear mismatch, skip.
3. **Have you already applied?** The duplicate guard checks automatically when you click Resume — you'll see a warning if you applied here in the last 30 days.

---

## Step 3 — Applying on a native ATS page (full flow)

These are pages on Greenhouse, Lever, Workday, Ashby, iCIMS, SmartRecruiters, BambooHR, JazzHR, or Rippling — the actual application form, not a LinkedIn proxy.

**This is the gold-standard flow. Use it whenever possible.**

### A. Tailor your resume

Click **Resume** in the Hemline button row.

- The extension scrapes the JD
- The server rewrites `swe.tex` to the role, picks the best skill rows and projects, compiles a PDF
- The ATS keyword match score appears in the button (e.g. "Resume (72%)")
- `Rohan_Resume_<Company>.pdf` lands in Downloads (~20–30 seconds)

> Aim for ≥ 70% ATS match. If it's low, the JD may be too far from your profile.

### B. Generate a cover letter (roles you care about)

Click **Resume & CL** instead. This fires tailor first, waits 1 second (free-tier rate limit buffer), then generates the cover letter. Two PDFs land in Downloads.

Use this for companies on your priority list, referrals, or any role where you want to stand out.

### C. Auto-Fill the application form

Before uploading your resume, click **Auto-Fill** above the form. It fills:

- Name, email, phone, LinkedIn, GitHub
- City, state, zip, country
- Work authorization, sponsorship (Yes/No radio)
- Education level (dropdown), university, major, grad year, GPA
- Years of experience, start date
- Salary range
- Consent checkboxes (agree to terms, authorize background check, etc.)
- **Attaches your resume PDF** (`swe.pdf`) directly into the file upload field

After filling, the Next/Continue button gets a green outline — review the filled fields, then click Next yourself. The system never auto-submits.

For multi-step forms: repeat Auto-Fill on each page.

### D. Fill anything it missed, upload CL, submit

Auto-Fill won't catch every custom question ("Why do you want to work here?", "Describe a time you…"). Answer those yourself. Upload the CL PDF if the form has a separate field. Submit.

---

## Step 4 — Applying via LinkedIn Easy Apply

When you click Easy Apply on LinkedIn, a modal drawer opens. The extension detects it automatically (no button click needed) and fills the form fields within the modal in ~400ms.

- Contact info, city/state, work authorization, sponsorship radio — all pre-filled
- The Next button gets a green outline
- Review each page and click Next yourself
- LinkedIn's resume upload step: if your `swe.pdf` hasn't been uploaded to LinkedIn before, it attaches it; otherwise LinkedIn may reuse its cached copy — check and replace if needed
- The extension never hits Submit

---

## Step 5 — Applying from the dashboard (no ATS form)

Some jobs in the stream link directly to a company's careers page (Remotive/Jobicy tend to list remote-only postings). From the dashboard:

1. Click the job card
2. Click **Tailor Resume** in the right panel — downloads the tailored PDF
3. Click **Tailor Cover Letter** if needed
4. Open the job URL and apply manually using the downloaded PDFs

The dashboard's tailoring panel is identical to the extension — same server, same LLM.

---

## Step 6 — Recruiter outreach (high-signal roles)

For roles where getting a referral or recruiter ping would meaningfully help:

### LinkedIn cold message (connection request)

On the job page, click **Message**:
- Generates a <300-char personalized outreach drawn from your resume and the JD
- Copies it to clipboard automatically
- Opens a LinkedIn people search for "[Company] recruiter" in a new tab
- Paste the message into the connection request

### Cold email

Click **Email**:
- Generates a subject line + 3-paragraph email body
- Opens a `mailto:` draft pre-filled with subject and body
- Find the recruiter's email from LinkedIn → hunter.io → company website

Use recruiter outreach for companies on your short list (top 10 targets), not for every application.

---

## Step 7 — End of day: review your ledger

Open **http://localhost:4567**, scroll to the **Applications** panel.

- Every successful `/tailor` or `/cover-letter` request is logged automatically: company, title, date, PDF path
- Search by company name, sort by date
- CSV export for spreadsheet tracking
- Duplicate guard: if you click Resume for a company you applied to in the last 30 days, the dashboard flags it before generating

Check the **Stats** panel for today's session:
- Total requests, average latency per endpoint
- Which LLM models succeeded/failed
- If relay is hitting failures, check `logs/pipeline.log` or switch to `LLM_PROVIDER=claude` in `.env`

---

## Daily rhythm at a glance

| Time | Action |
|---|---|
| Start of day | `npm start` in the project folder, confirm dashboard health is green |
| 15 min | Browse dashboard stream + jseek.co with H1-B + seniority filters on |
| Per job (~3–5 min) | Click Resume (or Resume & CL) → Auto-Fill ATS form → fill custom questions → submit |
| Per high-priority role | Also click Message → send LinkedIn connection request |
| End of day | Check Applications ledger, note any follow-up needed |

**Target:** 10–20 tailored applications per day with the system running. Auto-Fill cuts ATS form time from ~5 minutes to under 1 minute.

---

## Troubleshooting quick reference

| Problem | Fix |
|---|---|
| Hemline buttons not appearing | Server offline — run `npm start`. Check http://localhost:4567/health |
| Buttons greyed out | Same — server must be running during active use |
| Resume PDF didn't download | Check Downloads folder; look for a browser alert with a LaTeX error message |
| Auto-Fill clicked but 0 fields filled | The form may use non-standard field names — fill manually; open an issue to add selectors |
| Resume file not attached | `/tailor` must run at least once first to produce `swe.pdf`; click Resume first, then Auto-Fill |
| LinkedIn Easy Apply not filling | LinkedIn renames its CSS classes periodically — the selector may need updating |
| Match score < 50% | JD keywords don't overlap much with your resume; the LLM still tailors but check `logs/pipeline.log` for missing keywords |
| Relay failing | Check `GET /stats`, look at `logs/pipeline.log`; switch to `LLM_PROVIDER=claude` temporarily |
| Applied to this company already | Dashboard warns you; decide if the new role is different enough to apply again |

---

## What's NOT automated yet (next iteration)

- **Automatic form submission** — intentional. Every application is reviewed before submit.
- **Screening question answers** (behavioral: "Tell us about a time…") — require your manual input.
- **LinkedIn file upload reliability** — LinkedIn sometimes reuses a cached resume; always verify the uploaded file on the resume step.
- **Company-specific ATS targets** — the dashboard stream pulls public APIs; targeted sweeps of specific companies' Greenhouse/Lever/Ashby boards are planned (Job Stream v2).
- **Referral identification** — the LinkedIn icon on jseek.co helps you find recruiters, but identifying internal referrals from your network is still manual.
