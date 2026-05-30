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
- Claude Code CLI on PATH (`claude`) — used by the server to tailor resumes

## Formatting guidelines

- Plain ESM JavaScript (no TypeScript, no bundler) for all extension files
- Express.js for server.js
- Single quotes, 2-space indent, no semicolons
- No comments unless the WHY is non-obvious

For overarching project architecture and file structure, read docs/architecture.md.
