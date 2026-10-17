import { defineConfig, devices } from '@playwright/test'

const remoteUrl = process.env.POCKETLAB_PRODUCTION_URL
const baseURL = remoteUrl ?? 'http://127.0.0.1:4191'
if (remoteUrl && new URL(remoteUrl).protocol !== 'https:')
  throw new Error('A validação pública exige uma URL HTTPS.')

export default defineConfig({
  testDir: './tests/audio-mobile',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/audio-flow',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  ...(!remoteUrl && {
    webServer: {
      command: 'node scripts/serve-production.mjs --port 4191',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
  }),
})
