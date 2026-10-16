import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/production',
  testMatch: '**/bench-browser.spec.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  outputDir: '.work/benchmark-browser',
  use: { baseURL: 'http://127.0.0.1:4190', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/serve-production.mjs --port 4190',
    url: 'http://127.0.0.1:4190',
    reuseExistingServer: true,
  },
})
