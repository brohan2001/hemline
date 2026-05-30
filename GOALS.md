# Phase 3 Goals

## Tasks

- [x] Step 1: Git init + .gitignore hygiene
- [x] Step 2: GOALS.md task board
- [ ] Step 3: Vitest + Supertest test infrastructure
- [ ] Step 4: Performance timer on Resume and Resume+CL buttons
- [ ] Step 5: Multi-site SITE_CONFIGS (LinkedIn + Jobright)
- [ ] Step 6: Cold Message endpoint + Message button
- [ ] Step 7: Application Tracker Ledger (applied_jobs.json)

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
