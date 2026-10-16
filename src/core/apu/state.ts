import { DMG_CLOCK_HZ } from '../model'
import {
  stateBoolean,
  stateBytes,
  stateInteger,
  stateNumber,
  stateRecord,
} from '../state/validation'
import type { NoiseState, PulseState, WaveState } from './apu'

export interface ApuState {
  version: 1
  powered: boolean
  frameSequencerStep: number
  dividerCounter: number
  skipNextFrameEvent: boolean
  registers: Uint8Array
  waveRam: Uint8Array
  pulse1: PulseState
  pulse2: PulseState
  wave: WaveState
  noise: NoiseState
  sweep: { shadow: number; timer: number; enabled: boolean; negateUsed: boolean }
  sampling: {
    rate: number
    phase: number
    span: number
    sumLeft: number
    sumRight: number
    capacitorLeft: number
    capacitorRight: number
  }
}

function envelope(value: unknown, label: string) {
  const state = stateRecord(value, label)
  return {
    enabled: stateBoolean(state.enabled, `${label}.enabled`),
    dacEnabled: stateBoolean(state.dacEnabled, `${label}.dacEnabled`),
    length: stateInteger(state.length, 0, 64, `${label}.length`),
    lengthEnabled: stateBoolean(state.lengthEnabled, `${label}.lengthEnabled`),
    volume: stateInteger(state.volume, 0, 15, `${label}.volume`),
    envelopeTimer: stateInteger(state.envelopeTimer, 0, 9, `${label}.envelopeTimer`),
    envelopeRunning: stateBoolean(state.envelopeRunning, `${label}.envelopeRunning`),
  }
}

function pulse(value: unknown, label: string): PulseState {
  const state = stateRecord(value, label)
  return {
    ...envelope(state, label),
    frequency: stateInteger(state.frequency, 0, 2047, `${label}.frequency`),
    timer: stateInteger(state.timer, 0, 8195, `${label}.timer`),
    dutyPosition: stateInteger(state.dutyPosition, 0, 7, `${label}.dutyPosition`),
    triggered: stateBoolean(state.triggered, `${label}.triggered`),
    firstSample: stateBoolean(state.firstSample, `${label}.firstSample`),
  }
}

function wave(value: unknown): WaveState {
  const state = stateRecord(value, 'APU.wave')
  return {
    enabled: stateBoolean(state.enabled, 'APU.wave.enabled'),
    dacEnabled: stateBoolean(state.dacEnabled, 'APU.wave.dacEnabled'),
    length: stateInteger(state.length, 0, 256, 'APU.wave.length'),
    lengthEnabled: stateBoolean(state.lengthEnabled, 'APU.wave.lengthEnabled'),
    frequency: stateInteger(state.frequency, 0, 2047, 'APU.wave.frequency'),
    timer: stateInteger(state.timer, 0, 4102, 'APU.wave.timer'),
    position: stateInteger(state.position, 0, 31, 'APU.wave.position'),
    sampleBuffer: stateInteger(state.sampleBuffer, 0, 255, 'APU.wave.sampleBuffer'),
    accessWindow: stateInteger(state.accessWindow, 0, 2, 'APU.wave.accessWindow'),
  }
}

/** Valida o estado completo antes de alterar buffers, canais ou fila de apresentação. */
export function validateApuState(value: unknown): ApuState {
  const state = stateRecord(value, 'APU')
  stateInteger(state.version, 1, 1, 'APU.version')
  const sweep = stateRecord(state.sweep, 'APU.sweep')
  const sampling = stateRecord(state.sampling, 'APU.sampling')
  const rate = stateInteger(sampling.rate, 8000, 192000, 'APU.sampling.rate')
  const phase = stateInteger(sampling.phase, 0, DMG_CLOCK_HZ - 1, 'APU.sampling.phase')
  const span = stateInteger(sampling.span, 0, Math.ceil(DMG_CLOCK_HZ / rate), 'APU.sampling.span')
  const noise = stateRecord(state.noise, 'APU.noise')
  const valid: ApuState = {
    version: 1,
    powered: stateBoolean(state.powered, 'APU.powered'),
    frameSequencerStep: stateInteger(state.frameSequencerStep, 0, 7, 'APU.frameSequencerStep'),
    dividerCounter: stateInteger(state.dividerCounter, 0, 65535, 'APU.dividerCounter'),
    skipNextFrameEvent: stateBoolean(state.skipNextFrameEvent, 'APU.skipNextFrameEvent'),
    registers: stateBytes(state.registers, 0x17, 'APU.registers'),
    waveRam: stateBytes(state.waveRam, 16, 'APU.waveRam'),
    pulse1: pulse(state.pulse1, 'APU.pulse1'),
    pulse2: pulse(state.pulse2, 'APU.pulse2'),
    wave: wave(state.wave),
    noise: {
      ...envelope(noise, 'APU.noise'),
      timer: stateInteger(noise.timer, 0, 112 << 15, 'APU.noise.timer'),
      lfsr: stateInteger(noise.lfsr, 0, 0x7fff, 'APU.noise.lfsr'),
    },
    sweep: {
      shadow: stateInteger(sweep.shadow, 0, 2047, 'APU.sweep.shadow'),
      timer: stateInteger(sweep.timer, 0, 8, 'APU.sweep.timer'),
      enabled: stateBoolean(sweep.enabled, 'APU.sweep.enabled'),
      negateUsed: stateBoolean(sweep.negateUsed, 'APU.sweep.negateUsed'),
    },
    sampling: {
      rate,
      phase,
      span,
      sumLeft: stateNumber(sampling.sumLeft, -span, span, 'APU.sampling.sumLeft'),
      sumRight: stateNumber(sampling.sumRight, -span, span, 'APU.sampling.sumRight'),
      capacitorLeft: stateNumber(sampling.capacitorLeft, -1, 1, 'APU.sampling.capacitorLeft'),
      capacitorRight: stateNumber(sampling.capacitorRight, -1, 1, 'APU.sampling.capacitorRight'),
    },
  }
  const remainder = phase - span * rate
  if (remainder < 0 || remainder >= rate)
    throw new Error('Estado da APU inválido: fase de amostragem.')
  if (valid.registers[5] !== 0 || valid.registers[15] !== 0 || valid.registers[22] !== 0) {
    throw new Error('Estado da APU inválido: registradores reservados.')
  }
  for (const [channel, dac, control] of [
    [valid.pulse1, (valid.registers[2]! & 0xf8) !== 0, valid.registers[4]!],
    [valid.pulse2, (valid.registers[7]! & 0xf8) !== 0, valid.registers[9]!],
    [valid.wave, (valid.registers[10]! & 0x80) !== 0, valid.registers[14]!],
    [valid.noise, (valid.registers[17]! & 0xf8) !== 0, valid.registers[19]!],
  ] as const) {
    if (channel.dacEnabled !== dac || channel.lengthEnabled !== ((control & 0x40) !== 0)) {
      throw new Error('Estado da APU inválido: canal e registradores divergentes.')
    }
    if (
      channel.enabled &&
      (!valid.powered || !dac || (channel.lengthEnabled && channel.length === 0))
    ) {
      throw new Error('Estado da APU inválido: canal ativo sem gerador habilitado.')
    }
  }
  for (const [channel, offset] of [
    [valid.pulse1, 3],
    [valid.pulse2, 8],
    [valid.wave, 13],
  ] as const) {
    const frequency = valid.registers[offset]! | ((valid.registers[offset + 1]! & 7) << 8)
    if (channel.frequency !== frequency)
      throw new Error('Estado da APU inválido: frequência divergente.')
    if (channel.enabled && channel.timer === 0)
      throw new Error('Estado da APU inválido: timer ativo zerado.')
  }
  if (
    !valid.powered &&
    (valid.registers.some((byte) => byte !== 0) || valid.frameSequencerStep !== 0)
  ) {
    throw new Error('Estado da APU inválido: registradores com energia desligada.')
  }
  if (valid.skipNextFrameEvent && (!valid.powered || valid.frameSequencerStep !== 0)) {
    throw new Error('Estado da APU inválido: sincronização de DIV.')
  }
  return valid
}
