import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/hardware/timing.test.ts',
      ...(process.env.ROM_MILESTONE === 'M05' ? ['tests/hardware/acid2.test.ts'] : []),
    ],
    testTimeout: 120_000,
    maxWorkers: 2,
  },
})
