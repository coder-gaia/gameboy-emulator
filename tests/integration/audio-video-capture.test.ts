import { deepStrictEqual } from 'node:assert'
import { describe, expect, it } from 'vitest'
import { GameBoy } from '../../src/core/gameboy'
import { DMG_CLOCK_HZ, DMG_FRAME_T_CYCLES } from '../../src/core/model'
import { createVisualDiagnosticRom } from '../../src/core/diagnostics/visual-cartridge'
import { runAudioVideoBudget } from '../../src/runtime/audio-video-capture'
import { VideoBufferPool } from '../../src/runtime/video-buffer-pool'
import { buildTestRom } from '../fixtures/rom'

describe('captura de vídeo durante o mesmo orçamento PCM', () => {
  it.each([8000, 44100, 48000, 192000])(
    'captura todos os VBlanks e suas posições PCM exatas em %i Hz',
    (rate) => {
      const rom = buildTestRom({ program: [0xf3, 0x76] })
      const control = new GameBoy(rom)
      const device = new GameBoy(rom)
      control.bus.apu.setSampleRate(rate)
      device.bus.apu.setSampleRate(rate)
      const frames: { frameId: number; pcmFrame: number }[] = []
      const base = 1234
      const budget = 3 * DMG_FRAME_T_CYCLES + 37
      const consumed = runAudioVideoBudget(device, budget, base, (frame) =>
        frames.push({ frameId: frame.frameId, pcmFrame: frame.pcmFrame }),
      )
      expect(consumed).toBe(control.runCycles(budget))
      expect(frames).toEqual(
        [0, 1, 2].map((index) => ({
          frameId: index + 1,
          pcmFrame:
            base + Math.floor(((144 * 456 + index * DMG_FRAME_T_CYCLES) * rate) / DMG_CLOCK_HZ),
        })),
      )
      deepStrictEqual(device.snapshotState(), control.snapshotState())
      deepStrictEqual(device.bus.apu.drainSamples(), control.bus.apu.drainSamples())
    },
  )

  it('preserva estado e PCM do jardim enquanto captura imagens intermediárias diferentes no lote grande', () => {
    const rom = createVisualDiagnosticRom()
    const device = new GameBoy(rom)
    const control = new GameBoy(rom)
    for (const machine of [device, control]) {
      for (let frame = 0; frame < 8; frame += 1) machine.runFrame()
      machine.setButton('right', true)
      machine.bus.apu.discardSamples()
    }
    const initialFrame = device.frameId
    const captured: { frameId: number; pcmFrame: number; bytes: Uint8Array }[] = []
    const budget = DMG_FRAME_T_CYCLES * 8 + 123
    runAudioVideoBudget(device, budget, 5000, (frame) =>
      captured.push({
        frameId: frame.frameId,
        pcmFrame: frame.pcmFrame,
        bytes: frame.framebuffer.slice(),
      }),
    )
    control.runCycles(budget)
    expect(captured).toHaveLength(device.frameId - initialFrame)
    expect(captured.map((frame) => frame.frameId)).toEqual(
      Array.from({ length: captured.length }, (_, index) => initialFrame + index + 1),
    )
    expect(
      new Set(captured.map((frame) => Buffer.from(frame.bytes).toString('base64'))).size,
    ).toBeGreaterThan(4)
    expect(
      captured.every(
        (frame, index) => index === 0 || frame.pcmFrame > captured[index - 1]!.pcmFrame,
      ),
    ).toBe(true)
    deepStrictEqual(device.snapshotState(), control.snapshotState())
    deepStrictEqual(device.bus.apu.drainSamples(), control.bus.apu.drainSamples())
  })

  it('inclui VBlank seguido de LCD desligado dentro da mesma instrução sem perder a imagem completa', () => {
    const rom = buildTestRom({ program: [0xe0, 0x40, 0x76] })
    const device = new GameBoy(rom)
    const control = new GameBoy(rom)
    for (const machine of [device, control]) {
      machine.cpu.pc = 0x150
      machine.cpu.a = 0
      machine.bus.tick(144 * 456 - 4)
      machine.framebuffer.fill(3)
    }
    const captured: { frameId: number; firstPixel: number; pcmFrame: number }[] = []
    runAudioVideoBudget(device, 12, 0, (frame) =>
      captured.push({
        frameId: frame.frameId,
        firstPixel: frame.framebuffer[0]!,
        pcmFrame: frame.pcmFrame,
      }),
    )
    control.runCycles(12)
    expect(captured.map((frame) => [frame.frameId, frame.firstPixel])).toEqual([
      [1, 3],
      [1, 0],
    ])
    expect(captured[0]!.pcmFrame).toBeLessThanOrEqual(captured[1]!.pcmFrame)
    expect(device.bus.ppu.lcdEnabled).toBe(false)
    deepStrictEqual(device.snapshotState(), control.snapshotState())
    deepStrictEqual(device.bus.apu.drainSamples(), control.bus.apu.drainSamples())
  })

  it('notifica LCD off/on mesmo com frameId igual e não cria quadros sintéticos enquanto desligado', () => {
    const device = new GameBoy(
      buildTestRom({ program: [0xf3, 0x3e, 0, 0xe0, 0x40, 0x3e, 0x91, 0xe0, 0x40, 0x76] }),
    )
    const captured: number[] = []
    runAudioVideoBudget(device, 200, 0, (frame) => captured.push(frame.frameId))
    expect(captured).toEqual([0, 0])
    const off = new GameBoy(buildTestRom({ program: [0xf3, 0x3e, 0, 0xe0, 0x40, 0x76] }))
    const frames: number[] = []
    runAudioVideoBudget(off, 4 * DMG_FRAME_T_CYCLES, 0, (frame) => frames.push(frame.frameId))
    expect(frames).toEqual([0])
    expect(off.frameId).toBe(0)
  })

  it('mantém equivalência quando o pool se esgota sem alterar orçamento ou alocar outra arena', () => {
    const rom = buildTestRom({ program: [0xf3, 0x76] })
    const device = new GameBoy(rom)
    const control = new GameBoy(rom)
    const pool = new VideoBufferPool()
    let frames = 0
    let droppedFrames = 0
    const budget = 80 * DMG_FRAME_T_CYCLES
    // A APU é drenada por pedidos reais; aqui o orçamento maior testa apenas
    // equivalência, inclusive o mesmo descarte do ring PCM nas duas máquinas.
    runAudioVideoBudget(device, budget, 0, (frame) => {
      frames += 1
      if (!pool.lease(frame.framebuffer)) droppedFrames += 1
    })
    control.runCycles(budget)
    expect(frames).toBe(80)
    expect(pool.leasedBuffers).toBe(64)
    expect(droppedFrames).toBe(16)
    expect(pool.allocatedBytes).toBe(1_474_560)
    deepStrictEqual(device.snapshotState(), control.snapshotState())
    deepStrictEqual(device.bus.apu.drainSamples(), control.bus.apu.drainSamples())
  })

  it('restaura o observador anterior após sucesso, erro do callback e orçamento inválido', () => {
    const machine = new GameBoy(buildTestRom({ program: [0xf3, 0x76] }))
    let previousCalls = 0
    machine.bus.ppu.setPresentationObserver(() => {
      previousCalls += 1
    })
    runAudioVideoBudget(machine, DMG_FRAME_T_CYCLES, 0, () => {})
    expect(previousCalls).toBe(0)
    machine.runFrame()
    expect(previousCalls).toBe(1)
    expect(() =>
      runAudioVideoBudget(machine, DMG_FRAME_T_CYCLES, 0, () => {
        throw new Error('Falha controlada de apresentação.')
      }),
    ).toThrow(/controlada/)
    machine.runFrame()
    expect(previousCalls).toBe(2)
    expect(() => runAudioVideoBudget(machine, -1, 0, () => {})).toThrow(/orçamento/)
    machine.runFrame()
    expect(previousCalls).toBe(3)
    for (const base of [-1, 0.5, Infinity, NaN])
      expect(() => runAudioVideoBudget(machine, 0, base, () => {})).toThrow(/posição PCM/)
    machine.runFrame()
    expect(previousCalls).toBe(4)
  })

  it('não cria demanda artificial quando a CPU está em STOP', () => {
    const machine = new GameBoy(buildTestRom({ program: [0x10, 0] }))
    machine.runCycles(100)
    const before = machine.snapshotState()
    let frames = 0
    expect(
      runAudioVideoBudget(machine, 6144, 0, () => {
        frames += 1
      }),
    ).toBe(0)
    expect(frames).toBe(0)
    deepStrictEqual(machine.snapshotState(), before)
  })
})
