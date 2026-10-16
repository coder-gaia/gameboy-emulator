import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'
import { parseCartridgeHeader } from '../../src/core/cartridge'
import { DEMO_GAMES } from '../../src/platform/games/catalog'
import type { JoypadButton } from '../../src/core/joypad'

function advance(device: GameBoy, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    expect(device.runFrame()).toBeGreaterThan(0)
  }
}

function press(device: GameBoy, button: JoypadButton, followingFrames: number): void {
  device.setButton(button, true)
  advance(device, 3)
  device.setButton(button, false)
  advance(device, followingFrames)
}

it.each(DEMO_GAMES)(
  '$title preserva hash e header, inicia e responde aos controles no núcleo real',
  (game) => {
    const bytes = readFileSync(`public${game.romUrl}`)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(game.sha256)
    expect(existsSync(`public${game.creditsUrl}`)).toBe(true)
    const rom = new Uint8Array(bytes)
    const metadata = parseCartridgeHeader(rom)
    expect(metadata.isSupported).toBe(true)
    expect(metadata.checksumValid).toBe(true)
    expect(metadata.cgbMode).toBe('dmg')
    expect(metadata.mapper).toBe('MBC1')
    expect(metadata.hasBattery).toBe(true)
    const device = new GameBoy(rom)

    // A ROM original apresenta os logos e a animação dos autores antes do título.
    advance(device, game.id === 'tobu-tobu-girl' ? 900 : 180)
    press(device, 'start', 90)
    if (game.id === 'tobu-tobu-girl') {
      press(device, 'start', 90)
      press(device, 'a', 150)
      // O primeiro OBJ acompanha a personagem. Aguardar a animação de entrada
      // permite verificar movimento efetivo, além das transições de telas.
      const playerX = device.bus.ppu.oam[1]!
      device.setButton('right', true)
      advance(device, 6)
      device.setButton('right', false)
      advance(device, 2)
      expect(device.bus.ppu.oam[1]).toBeGreaterThan(playerX)
    } else {
      // W_2048GRID, declarado na revisão de constants.asm fixada no manifesto.
      const board = (): number[] =>
        Array.from({ length: 16 }, (_, index) => device.bus.read8Direct(0xc800 + index))
      const previousBoard = board()
      expect(previousBoard.filter((value) => value !== 0)).toHaveLength(2)
      for (const direction of ['left', 'up', 'right', 'down'] as const) {
        press(device, direction, 20)
      }
      expect(board()).not.toEqual(previousBoard)
      expect(board().filter((value) => value !== 0).length).toBeGreaterThan(2)
    }
    expect(device.frameId).toBeGreaterThan(100)
    expect(new Set(device.framebuffer).size).toBeGreaterThan(1)
    expect(device.cartridge.batteryRevision).toBeGreaterThan(0)
  },
  30_000,
)
