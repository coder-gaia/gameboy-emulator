import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Mbc2Cartridge, Mbc5Cartridge, createCartridge } from '../../src/core/cartridge'
import { runHardwareRom } from '../helpers/hardware-runner'
import type { HardwareProtocol } from '../helpers/hardware-runner'
import { createHardwareBus } from '../helpers/test-cartridge'

const manifest = JSON.parse(readFileSync('tests/roms/mbc-extended-manifest.json', 'utf8')) as {
  tests: {
    id: string
    path: string
    sha256: string
    protocol: HardwareProtocol
    maxTCycles: number
  }[]
}

describe('Mooneye MBC2, MBC5 e OAM DMA com mappers do produto', () => {
  it.each(manifest.tests)('$id', (entry) => {
    const rom = new Uint8Array(readFileSync(entry.path))
    expect(createHash('sha256').update(rom).digest('hex')).toBe(entry.sha256)
    expect(createCartridge(rom)).toBeInstanceOf(
      entry.id.includes('/mbc2/') ? Mbc2Cartridge : Mbc5Cartridge,
    )
    const result = runHardwareRom(rom, entry.protocol, entry.maxTCycles, createHardwareBus)
    expect(result.passed, JSON.stringify({ id: entry.id, ...result }, null, 2)).toBe(true)
  })
})
