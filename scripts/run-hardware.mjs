import { spawnSync } from 'node:child_process'
const milestone = process.argv.at(-1)
if (!['M03', 'M04', 'M05', 'M06', 'M07'].includes(milestone)) {
  throw new Error('Escolha M03, M04, M05, M06 ou M07.')
}
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.hardware.config.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, ROM_MILESTONE: milestone },
  },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
