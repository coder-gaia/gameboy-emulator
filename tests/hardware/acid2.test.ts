import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'

it('dmg-acid2 coincide com os 23.040 pixels da referência DMG oficial', () => {
  const manifest = JSON.parse(readFileSync('tests/roms/acid2-manifest.json', 'utf8')) as {
    rom: { path: string; sha256: string }
    reference: { path: string; sha256: string; width: number; height: number; shadeRgb: number[] }
    maxTCycles: number
  }
  const rom = readFileSync(manifest.rom.path)
  const referenceBytes = readFileSync(manifest.reference.path)
  expect(createHash('sha256').update(rom).digest('hex')).toBe(manifest.rom.sha256)
  expect(createHash('sha256').update(referenceBytes).digest('hex')).toBe(manifest.reference.sha256)
  const expected = PNG.sync.read(referenceBytes)
  expect([expected.width, expected.height]).toEqual([160, 144])
  const device = new GameBoy(new Uint8Array(rom))
  while (device.frameId < 10 && device.cpu.totalTCycles < manifest.maxTCycles) {
    if (device.step() === 0) throw new Error('A CPU parou antes de produzir a imagem do dmg-acid2.')
  }
  expect(device.frameId).toBe(10)
  expect(device.framebuffer.length).toBe(160 * 144)
  const actual = new PNG({ width: 160, height: 144 })
  const differences = new PNG({ width: 160, height: 144 })
  let mismatches = 0
  for (let index = 0; index < device.framebuffer.length; index += 1) {
    const offset = index * 4
    const gray = manifest.reference.shadeRgb[device.framebuffer[index]!]!
    const matches = [0, 1, 2].every((channel) => expected.data[offset + channel] === gray)
    if (!matches) mismatches += 1
    for (let channel = 0; channel < 3; channel += 1) {
      actual.data[offset + channel] = gray
      differences.data[offset + channel] = matches
        ? expected.data[offset + channel]! / 4
        : channel === 0
          ? 255
          : 0
    }
    actual.data[offset + 3] = 255
    differences.data[offset + 3] = 255
  }
  if (mismatches) {
    mkdirSync('test-results/hardware', { recursive: true })
    writeFileSync('test-results/hardware/dmg-acid2-actual.png', PNG.sync.write(actual))
    writeFileSync('test-results/hardware/dmg-acid2-differences.png', PNG.sync.write(differences))
    writeFileSync('test-results/hardware/dmg-acid2-reference.png', referenceBytes)
  }
  expect(mismatches, 'Consulte test-results/hardware para as imagens de diagnóstico.').toBe(0)
})
