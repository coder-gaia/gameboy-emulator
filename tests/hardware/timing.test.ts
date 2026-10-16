import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runHardwareRom } from '../helpers/hardware-runner'
import type { HardwareProtocol } from '../helpers/hardware-runner'
import { createHardwareBus } from '../helpers/test-cartridge'

interface RomEntry {
  id: string
  path: string
  sha256: string
  protocol: HardwareProtocol
  milestone: string
  maxTCycles: number
}

const manifest = JSON.parse(readFileSync('tests/roms/manifest.json', 'utf8')) as {
  tests: RomEntry[]
}
const milestone = process.env.ROM_MILESTONE ?? 'M03'
const entries = manifest.tests.filter((entry) => entry.milestone <= milestone)

describe(`ROMs externas do perfil DMG até ${milestone}`, () => {
  it.each(entries)('$id', (entry) => {
    const rom = new Uint8Array(readFileSync(entry.path))
    expect(createHash('sha256').update(rom).digest('hex')).toBe(entry.sha256)
    const result = runHardwareRom(rom, entry.protocol, entry.maxTCycles, createHardwareBus)
    expect(result.passed, JSON.stringify({ id: entry.id, ...result }, null, 2)).toBe(true)
  })
})
