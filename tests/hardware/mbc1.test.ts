import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Mbc1Cartridge, createCartridge } from '../../src/core/cartridge'
import { runHardwareRom } from '../helpers/hardware-runner'
import type { HardwareProtocol } from '../helpers/hardware-runner'
import { createHardwareBus } from '../helpers/test-cartridge'

const manifest = JSON.parse(readFileSync('tests/roms/mbc1-manifest.json', 'utf8')) as {
  tests: {
    id: string
    path: string
    sha256: string
    protocol: HardwareProtocol
    maxTCycles: number
  }[]
}

describe('Mooneye MBC1 com mapper real do produto', () => {
  it.each(manifest.tests)('$id', (entry) => {
    const rom = new Uint8Array(readFileSync(entry.path))
    expect(createHash('sha256').update(rom).digest('hex')).toBe(entry.sha256)
    expect(createCartridge(rom)).toBeInstanceOf(Mbc1Cartridge)
    const result = runHardwareRom(rom, entry.protocol, entry.maxTCycles, createHardwareBus)
    expect(result.passed, JSON.stringify({ id: entry.id, ...result }, null, 2)).toBe(true)
  })
})
