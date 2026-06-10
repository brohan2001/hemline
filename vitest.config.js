import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    exclude: ['tests/live.test.js', 'node_modules/**'],
  },
})
