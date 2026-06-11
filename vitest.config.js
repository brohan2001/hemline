import { defineConfig } from 'vitest/config'

// Live suites hit real servers/browsers, so they only run when explicitly
// opted in via their dedicated npm scripts (vitest --exclude appends rather
// than overrides, so an env flag is the only way to lift the exclusion).
const liveSuites = process.env.JSEEK_LIVE ? [] : ['tests/live.test.js', 'tests/ui_live.test.js']

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    exclude: [...liveSuites, 'node_modules/**'],
  },
})
