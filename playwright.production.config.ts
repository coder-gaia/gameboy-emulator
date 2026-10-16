import { defineConfig, devices } from '@playwright/test'

const remoteUrl = process.env.POCKETLAB_PRODUCTION_URL
const baseURL = remoteUrl ?? 'http://127.0.0.1:4190'
if (remoteUrl && new URL(remoteUrl).protocol !== 'https:')
  throw new Error('A validação pública exige uma URL HTTPS.')

export default defineConfig({
  testDir: './tests/production',
  testIgnore: '**/bench-browser.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/production',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  ...(!remoteUrl && {
    webServer: {
      command: 'node scripts/serve-production.mjs --port 4190',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
  }),
})
