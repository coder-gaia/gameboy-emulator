import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/hardware/**/*.test.ts'],
    testTimeout: 120_000,
    maxWorkers: 2,
  },
})
