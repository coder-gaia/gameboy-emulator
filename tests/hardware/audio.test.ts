import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runAudioHardwareRom } from '../helpers/audio-runner'

const manifest = JSON.parse(readFileSync('tests/roms/audio-manifest.json', 'utf8')) as {
  tests: {
    id: string
    path: string
    sha256: string
    protocol: 'blargg-memory'
    maxTCycles: number
  }[]
}

describe('Blargg dmg_sound com APU e cartucho originais', () => {
  it.each(manifest.tests)('$id', (entry) => {
    const rom = new Uint8Array(readFileSync(entry.path))
    expect(createHash('sha256').update(rom).digest('hex')).toBe(entry.sha256)
    expect(entry.protocol).toBe('blargg-memory')
    const result = runAudioHardwareRom(rom, entry.maxTCycles)
    expect(result.passed, JSON.stringify({ id: entry.id, ...result }, null, 2)).toBe(true)
  })
})
