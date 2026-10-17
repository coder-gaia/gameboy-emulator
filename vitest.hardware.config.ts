import { defineConfig } from 'vitest/config'

const milestone = process.env.ROM_MILESTONE ?? 'M03'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/hardware/timing.test.ts',
      ...(milestone >= 'M05' ? ['tests/hardware/acid2.test.ts'] : []),
      ...(milestone >= 'M06' ? ['tests/hardware/mbc1.test.ts'] : []),
      ...(milestone >= 'M07' ? ['tests/hardware/audio.test.ts'] : []),
      ...(milestone >= 'M12' ? ['tests/hardware/mbc-extended.test.ts'] : []),
    ],
    testTimeout: 120_000,
    maxWorkers: 2,
  },
})
