# Publishing JSeek

JSeek ships as two public pieces:

1. **The browser extension** on the Chrome Web Store and Firefox Add-ons (AMO). It is fully standalone: users bring their own AI key, LaTeX compiles to PDF inside the browser (WASM pdfTeX), and everything is stored locally.
2. **The job feed and website** on GitHub Pages: `https://brohan2001.github.io/resume-extension/` hosts `jobs.json` (rebuilt about every 30 minutes by `.github/workflows/feed.yml`), the landing page, and the privacy policy the stores require.

The links to share are the store listing (where people install it) and the Pages URL (landing page and privacy policy).

`server.js` is not deployed. It stays as an optional local backend for development (Settings → Advanced → Processing → local server).

## One-time setup

### GitHub Pages (job feed, landing page, privacy policy)

1. Commit and push `data/`, `site/`, `jobstream.js`, `pipeline/jobfilter.js`, `scripts/build-feed.mjs`, and `.github/workflows/feed.yml` to `main`.
2. In the repo, open **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Open **Actions → Job feed → Run workflow**. One run takes about 2 minutes (~3,000 jobs).
4. Check that `https://brohan2001.github.io/resume-extension/jobs.json` loads. The extension's `FEED_URL` (in `dashboard.js`) points there.

GitHub pauses scheduled workflows after 60 days with no repository activity. Re-enable the workflow from the Actions tab if the feed goes stale.

### Chrome Web Store

1. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 fee).
2. Run `npm run build` to create `dist/jseek-chrome.zip`.
3. Create a new item and upload the zip. Use **Unlisted** visibility for the first release.
4. Fill in the listing:
   - Screenshots from `store-assets/` (1280×800). Add one real screenshot of the buttons on a LinkedIn or Greenhouse posting.
   - Privacy policy URL: `https://brohan2001.github.io/resume-extension/privacy.html`.
   - Single purpose: "Tailor the user's resume and cover letter to the job posting they are viewing and help them apply."
5. Permission justifications (the review asks for each one):

| Permission | Justification |
|---|---|
| Host access to job boards (LinkedIn, Indeed, Greenhouse, …) | Read the job description and inject the Resume/Cover Letter buttons; auto-fill application forms when the user clicks Auto-Fill. |
| `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.groq.com`, `api.cerebras.ai` | Send the user's resume and the job description to the AI provider whose API key the user entered. |
| `offscreen` | Run the bundled WebAssembly LaTeX compiler in a Worker (MV3 service workers cannot start Workers). |
| `downloads` | Save the generated PDFs. |
| `storage` | Keep the user's keys, resume, profile, and application history locally. |
| `scripting` + optional `*://*/*` | Only when the user turns on "every careers page" in settings: register the content script on unmapped careers sites. |
| optional `http://localhost:4567/*` | Only when the user picks the developer local-server backend. |
| `tabs` | Batch apply: open each selected job's application page in a background tab. |
| `clipboardWrite` | Copy generated LinkedIn messages. |
| `wasm-unsafe-eval` (CSP) | Required to instantiate the bundled pdfTeX WebAssembly module. No remote code is loaded. |

6. Data-use disclosures: the extension handles personally identifiable information (resume, contact details) and website content (job descriptions). It does not sell them or use them for unrelated purposes. Data goes only to the AI provider the user configures.

### Firefox Add-ons (AMO)

1. Create an account at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) (free).
2. Run `npm run build` to create `dist/jseek-firefox.zip`. `npx web-ext lint --source-dir dist/firefox` should show 0 errors.
3. Upload as a listed add-on. AMO requires source code for minified files, so link the GitHub repo and note that `vendor/anthropic-sdk.js` is built with `npm run vendor:sdk` from `@anthropic-ai/sdk`, and `vendor/swiftlatex/` comes from SwiftLaTeX release v20022022 with one documented patch.
4. The gecko id is `jseek-enhancer@jseek.extension` (in `manifest_firefox.json`).

## Every release

1. Bump `version` in both `manifest.json` and `manifest_firefox.json`.
2. Run `npm test`, then `npm run test:e2e` (loads the built extension in Chromium).
3. Run `npm run build` and upload both zips.

## Licensing note

The bundled LaTeX engine (`vendor/swiftlatex/`) is AGPL-3.0, and pdfTeX is GPL. Distributing the extension means distributing those components, so JSeek is licensed AGPL-3.0 (`LICENSE`) and its source must stay public. Jake Gutierrez's resume template, which `templates/` is based on, is MIT.

## Rebuilding the bundled TeX files

`vendor/texlive/` holds only the 77 TeX files the templates need, plus a pdfTeX format built for the SwiftLaTeX engine. Rebuild after changing template packages:

```bash
node scripts/texlive/serve.mjs          # needs a local TeX Live (kpsewhich)
# open http://localhost:8765, click "Build format", then "Compile templates"
node scripts/texlive/serve.mjs --manifest
npm run build:texmf
```
