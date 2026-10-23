import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results'
})
