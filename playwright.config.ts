import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e-playwright/**/*.test.ts', 'generated/playwright/**/*.spec.ts'],
  testIgnore: ['**/fixtures/**/*.test.ts'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
