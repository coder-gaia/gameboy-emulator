import { describe, expect, it } from 'vitest'
import { Apu } from '../../src/core/apu'
import type { ApuState } from '../../src/core/apu'

function configured(rate = 48_000): Apu {
  const apu = new Apu(rate)
  apu.reset(false)
  apu.writeRegister(0xff26, 0x80)
  apu.writeRegister(0xff24, 0x77)
  apu.writeRegister(0xff25, 0xff)
  apu.writeRegister(0xff10, 0x29)
  apu.writeRegister(0xff11, 0xb0)
  apu.writeRegister(0xff12, 0xa2)
  apu.writeRegister(0xff13, 0)
  apu.writeRegister(0xff14, 0xc4)
  apu.writeRegister(0xff16, 0xc0)
  apu.writeRegister(0xff17, 0x63)
  apu.writeRegister(0xff18, 0xaa)
  apu.writeRegister(0xff19, 0x87)
  for (let index = 0; index < 16; index += 1) apu.writeRegister(0xff30 + index, index * 17)
  apu.writeRegister(0xff1a, 0x80)
  apu.writeRegister(0xff1b, 0xb1)
  apu.writeRegister(0xff1c, 0x40)
  apu.writeRegister(0xff1d, 0xfe)
  apu.writeRegister(0xff1e, 0xc7)
  apu.writeRegister(0xff20, 0x20)
  apu.writeRegister(0xff21, 0x59)
  apu.writeRegister(0xff22, 0x1b)
  apu.writeRegister(0xff23, 0xc0)
  return apu
}

function run(apu: Apu, cycles: number, divider = 0): number {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const previous = divider
    divider = (divider + 1) & 0xffff
    if ((previous & 0x1000) !== 0 && (divider & 0x1000) === 0) apu.clockFrameSequencer()
    apu.tick(1)
  }
  apu.setDividerCounter(divider)
  return divider
}

describe('estado completo da APU', () => {
  it('descarta apenas a fila PCM, preservando fase, somas parciais e capacitores do estado', () => {
    const apu = configured()
    run(apu, 12345)
    expect(apu.pendingSampleFrames).toBeGreaterThan(0)
    const before = apu.snapshotState()
    expect(before.sampling.span).toBeGreaterThan(0)
    apu.discardSamples()
    expect(apu.pendingSampleFrames).toBe(0)
    expect(apu.droppedSampleFrames).toBe(0)
    expect(apu.snapshotState()).toEqual(before)
  })
  it.each([44_100, 48_000, 96_000])(
    'reproduz PCM idêntico após restore em %i Hz, incluindo envelopes, sweep e HPF',
    (rate) => {
      const original = configured(rate)
      const divider = run(original, 123_457)
      const state = original.snapshotState()
      expect(original.pendingSampleFrames).toBeGreaterThan(0)
      original.drainSamples()
      const finalDivider = run(original, 300_003, divider)
      const expected = original.drainSamples()
      const expectedState = original.snapshotState()

      const restored = new Apu(8_000)
      restored.tick(1000)
      restored.restoreState(state)
      expect(restored.pendingSampleFrames).toBe(0)
      expect(restored.sampleRate).toBe(rate)
      expect(run(restored, 300_003, divider)).toBe(finalDivider)
      const actual = restored.drainSamples()
      expect(actual.some((sample) => sample !== 0)).toBe(true)
      expect(actual).toEqual(expected)
      expect(restored.snapshotState()).toEqual(expectedState)
    },
  )

  it('continua acesso e corrupção de wave RAM no mesmo T-cycle após restaurar', () => {
    const original = configured()
    original.tick(10 + 4 * 15 + 2)
    const state = original.snapshotState()
    expect(state.wave.timer).toBe(2)
    const restored = new Apu()
    restored.restoreState(state)
    for (const apu of [original, restored]) {
      apu.writeRegister(0xff1e, 0xc7)
      apu.tick(10)
      apu.writeRegister(0xff3f, 0x12)
      apu.writeRegister(0xff1a, 0)
    }
    expect(restored.snapshotState()).toEqual(original.snapshotState())
    expect(Array.from(restored.snapshotState().waveRam.subarray(0, 4))).toEqual([
      0x12, 0x99, 0xaa, 0xbb,
    ])
  })

  it.each([false, true])(
    'aceita snapshot pós boot %s sem expor buffers de hardware',
    (postBoot) => {
      const apu = new Apu()
      apu.reset(postBoot)
      apu.tick(431)
      const state = apu.snapshotState()
      const clone = new Apu()
      clone.restoreState(state)
      expect(clone.snapshotState()).toEqual(state)
      state.registers.fill(0xff)
      state.waveRam.fill(0xff)
      state.pulse1.volume = 15
      expect(clone.readRegister(0xff30)).toBe(0)
      expect(clone.snapshotState().pulse1.volume).toBe(0)
    },
  )

  it('preserva o salto do primeiro DIV, length durante power-off e sweep negate usado', () => {
    const apu = configured()
    apu.writeRegister(0xff26, 0)
    apu.writeRegister(0xff11, 63)
    const off = apu.snapshotState()
    apu.restoreState(off)
    apu.setDividerCounter(0x1000)
    apu.writeRegister(0xff26, 0x80)
    const waiting = apu.snapshotState()
    expect(waiting.skipNextFrameEvent).toBe(true)
    apu.restoreState(waiting)
    apu.clockFrameSequencer()
    expect(apu.snapshotState().frameSequencerStep).toBe(0)
    const sweep = configured()
    const state = sweep.snapshotState()
    expect(state.sweep.negateUsed).toBe(true)
    sweep.restoreState(state)
    sweep.writeRegister(0xff10, 0x21)
    expect(sweep.readRegister(0xff26) & 1).toBe(0)
  })

  it('valida campos tardios e coerência inteira antes de alterar estado ou fila', () => {
    const apu = configured()
    run(apu, 12345)
    const before = apu.snapshotState()
    const pending = apu.pendingSampleFrames
    const mutations: ((state: ApuState) => unknown)[] = [
      (state) => ({ ...state, version: 2 }),
      (state) => ({ ...state, waveRam: new Uint8Array(15) }),
      (state) => ({ ...state, noise: { ...state.noise, lfsr: 0x8000 } }),
      (state) => ({ ...state, wave: { ...state.wave, accessWindow: 3 } }),
      (state) => ({ ...state, pulse1: { ...state.pulse1, frequency: 0 } }),
      (state) => ({ ...state, pulse2: { ...state.pulse2, enabled: true, dacEnabled: false } }),
      (state) => ({ ...state, sampling: { ...state.sampling, capacitorRight: NaN } }),
      (state) => ({ ...state, sampling: { ...state.sampling, phase: 4_194_304 } }),
      (state) => ({ ...state, sampling: { ...state.sampling, sumLeft: Infinity } }),
      (state) => ({ ...state, sampling: { ...state.sampling, rate: 1 } }),
    ]
    for (const mutation of mutations) {
      expect(() => apu.restoreState(mutation(before))).toThrow()
      expect(apu.snapshotState()).toEqual(before)
      expect(apu.pendingSampleFrames).toBe(pending)
    }
  })
})
