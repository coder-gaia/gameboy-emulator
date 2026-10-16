import { DMG_CLOCK_HZ } from '../model'
import { validateApuState } from './state'
import type { ApuState } from './state'

const REGISTER_MASKS = new Uint8Array([
  0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff,
  0xff, 0x00, 0x00, 0xbf, 0x00, 0x00, 0x70,
])
const DUTY_PATTERNS = [0x01, 0x81, 0x87, 0x7e] as const
const NOISE_DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112] as const
const MAX_BUFFERED_FRAMES = 16_384

interface LengthState {
  enabled: boolean
  length: number
  lengthEnabled: boolean
}

interface EnvelopeState extends LengthState {
  dacEnabled: boolean
  volume: number
  envelopeTimer: number
  envelopeRunning: boolean
}

export interface PulseState extends EnvelopeState {
  frequency: number
  timer: number
  dutyPosition: number
  triggered: boolean
  firstSample: boolean
}

export interface WaveState extends LengthState {
  dacEnabled: boolean
  frequency: number
  timer: number
  position: number
  sampleBuffer: number
  accessWindow: number
}

export interface NoiseState extends EnvelopeState {
  timer: number
  lfsr: number
}

export interface ApuSnapshot {
  powered: boolean
  frameSequencerStep: number
  dividerCounter: number
  skipNextFrameEvent: boolean
  registers: Uint8Array
  waveRam: Uint8Array
  pulse1: PulseState & { output: number }
  pulse2: PulseState & { output: number }
  wave: WaveState & { output: number }
  noise: NoiseState & { output: number }
  sweep: { shadow: number; timer: number; enabled: boolean; negateUsed: boolean }
}

function pulseState(length = 0): PulseState {
  return {
    enabled: false,
    dacEnabled: false,
    length,
    lengthEnabled: false,
    frequency: 0,
    timer: 0,
    dutyPosition: 0,
    triggered: false,
    firstSample: true,
    volume: 0,
    envelopeTimer: 0,
    envelopeRunning: false,
  }
}

function waveState(length = 0): WaveState {
  return {
    enabled: false,
    dacEnabled: false,
    length,
    lengthEnabled: false,
    frequency: 0,
    timer: 0,
    position: 0,
    sampleBuffer: 0,
    accessWindow: 0,
  }
}

function noiseState(length = 0): NoiseState {
  return {
    enabled: false,
    dacEnabled: false,
    length,
    lengthEnabled: false,
    timer: 0,
    lfsr: 0x7fff,
    volume: 0,
    envelopeTimer: 0,
    envelopeRunning: false,
  }
}

/**
 * APU DMG: quatro geradores, mixer estéreo e filtro passa-altas.
 * DIV bit 12 clocka o sequenciador externamente; tick recebe apenas T-cycles.
 * Fontes: https://gbdev.io/pandocs/Audio_Registers.html
 * https://gbdev.io/pandocs/Audio_details.html
 */
export class Apu {
  private readonly registers = new Uint8Array(0x17)
  private readonly waveRam = new Uint8Array(16)
  private readonly samples = new Float32Array(MAX_BUFFERED_FRAMES * 2)
  private pulse1 = pulseState()
  private pulse2 = pulseState()
  private wave = waveState()
  private noise = noiseState()
  private powered = false
  private frameStep = 0
  private dividerCounter = 0
  private skipNextFrameEvent = false
  private sweepShadow = 0
  private sweepTimer = 0
  private sweepEnabled = false
  private sweepNegateUsed = false
  private rate = 48_000
  private samplePhase = 0
  private sampleSpan = 0
  private sampleSumLeft = 0
  private sampleSumRight = 0
  private mixedLeft = 0
  private mixedRight = 0
  private anyDac = false
  private capacitorLeft = 0
  private capacitorRight = 0
  private filterFactor = 0
  private readFrame = 0
  private writeFrame = 0
  private queuedFrames = 0
  private droppedFrames = 0

  constructor(sampleRate = 48_000) {
    this.setSampleRate(sampleRate)
    this.reset(true)
  }

  get sampleRate(): number {
    return this.rate
  }
  get pendingSampleFrames(): number {
    return this.queuedFrames
  }
  get droppedSampleFrames(): number {
    return this.droppedFrames
  }

  setSampleRate(rate: number): void {
    if (!Number.isSafeInteger(rate) || rate < 8_000 || rate > 192_000) {
      throw new Error('A taxa de áudio precisa ser inteira, entre 8000 e 192000 Hz.')
    }
    this.rate = rate
    this.filterFactor = Math.pow(0.999958, DMG_CLOCK_HZ / rate)
    this.clearSamples()
  }

  setDividerCounter(counter: number): void {
    this.dividerCounter = counter & 0xffff
  }

  reset(postBoot = true): void {
    this.registers.fill(0)
    this.waveRam.fill(0)
    this.pulse1 = pulseState()
    this.pulse2 = pulseState()
    this.wave = waveState()
    this.noise = noiseState()
    this.powered = postBoot
    this.frameStep = 0
    this.dividerCounter = 0
    this.skipNextFrameEvent = false
    this.sweepShadow = 0
    this.sweepTimer = 0
    this.sweepEnabled = false
    this.sweepNegateUsed = false
    if (postBoot) {
      this.registers[1] = 0x80
      this.registers[2] = 0xf3
      this.registers[3] = 0xff
      this.registers[4] = 7
      this.registers[0x14] = 0x77
      this.registers[0x15] = 0xf3
      this.pulse1.enabled = true
      this.pulse1.dacEnabled = true
      this.pulse1.frequency = 0x7ff
      this.pulse1.timer = 4
      this.pulse1.length = 1
      this.pulse1.triggered = true
      // A sequência sonora de boot terminou; o envelope já está silencioso.
      this.pulse1.volume = 0
    }
    this.refreshMixer()
    this.capacitorLeft = this.mixedLeft
    this.capacitorRight = this.mixedRight
    this.clearSamples()
  }

  readRegister(address: number): number {
    if (address >= 0xff30 && address <= 0xff3f) {
      if (!this.wave.enabled) return this.waveRam[address & 15]!
      return this.wave.accessWindow > 0 ? this.waveRam[this.wave.position >>> 1]! : 0xff
    }
    if (address === 0xff26) {
      return (
        0x70 |
        (this.powered ? 0x80 : 0) |
        (this.pulse1.enabled ? 1 : 0) |
        (this.pulse2.enabled ? 2 : 0) |
        (this.wave.enabled ? 4 : 0) |
        (this.noise.enabled ? 8 : 0)
      )
    }
    const offset = address - 0xff10
    return offset >= 0 && offset < this.registers.length
      ? this.registers[offset]! | REGISTER_MASKS[offset]!
      : 0xff
  }

  writeRegister(address: number, value: number): void {
    const byte = value & 0xff
    if (address >= 0xff30 && address <= 0xff3f) {
      if (!this.wave.enabled) this.waveRam[address & 15] = byte
      else if (this.wave.accessWindow > 0) this.waveRam[this.wave.position >>> 1] = byte
      return
    }
    if (address === 0xff26) {
      this.setPower((byte & 0x80) !== 0)
      return
    }
    const offset = address - 0xff10
    if (offset < 0 || offset >= this.registers.length || offset === 5 || offset === 15) return

    // No DMG, os contadores de length continuam graváveis com a APU desligada.
    if (address === 0xff11) this.pulse1.length = 64 - (byte & 63)
    else if (address === 0xff16) this.pulse2.length = 64 - (byte & 63)
    else if (address === 0xff1b) this.wave.length = 256 - byte
    else if (address === 0xff20) this.noise.length = 64 - (byte & 63)
    if (!this.powered) return

    const previous = this.registers[offset]!
    this.registers[offset] = byte
    switch (address) {
      case 0xff10:
        if ((previous & 8) !== 0 && (byte & 8) === 0 && this.sweepNegateUsed)
          this.pulse1.enabled = false
        break
      case 0xff12:
        this.writeEnvelope(this.pulse1, previous, byte)
        break
      case 0xff17:
        this.writeEnvelope(this.pulse2, previous, byte)
        break
      case 0xff21:
        this.writeEnvelope(this.noise, previous, byte)
        break
      case 0xff13:
        this.pulse1.frequency = (this.pulse1.frequency & 0x700) | byte
        break
      case 0xff18:
        this.pulse2.frequency = (this.pulse2.frequency & 0x700) | byte
        break
      case 0xff1d:
        this.wave.frequency = (this.wave.frequency & 0x700) | byte
        break
      case 0xff14:
        this.pulse1.frequency = (this.pulse1.frequency & 0xff) | ((byte & 7) << 8)
        this.writeControl(this.pulse1, byte, 64)
        if ((byte & 0x80) !== 0) {
          this.triggerPulse(this.pulse1, 2)
          this.triggerSweep()
        }
        break
      case 0xff19:
        this.pulse2.frequency = (this.pulse2.frequency & 0xff) | ((byte & 7) << 8)
        this.writeControl(this.pulse2, byte, 64)
        if ((byte & 0x80) !== 0) this.triggerPulse(this.pulse2, 7)
        break
      case 0xff1a:
        this.wave.dacEnabled = (byte & 0x80) !== 0
        if (!this.wave.dacEnabled) this.wave.enabled = false
        break
      case 0xff1e:
        this.wave.frequency = (this.wave.frequency & 0xff) | ((byte & 7) << 8)
        this.writeControl(this.wave, byte, 256)
        if ((byte & 0x80) !== 0) this.triggerWave()
        break
      case 0xff23:
        this.writeControl(this.noise, byte, 64)
        if ((byte & 0x80) !== 0) {
          this.noise.enabled = this.noise.dacEnabled
          this.noise.lfsr = 0x7fff
          this.noise.timer = this.noisePeriod()
          this.triggerEnvelope(this.noise, 0x11)
        }
        break
    }
    this.refreshMixer()
  }

  clockFrameSequencer(): void {
    if (!this.powered) return
    if (this.skipNextFrameEvent) {
      this.skipNextFrameEvent = false
      return
    }
    if ((this.frameStep & 1) === 0) {
      this.clockLength(this.pulse1)
      this.clockLength(this.pulse2)
      this.clockLength(this.wave)
      this.clockLength(this.noise)
    }
    if (this.frameStep === 2 || this.frameStep === 6) this.clockSweep()
    if (this.frameStep === 7) {
      this.clockEnvelope(this.pulse1, 2)
      this.clockEnvelope(this.pulse2, 7)
      this.clockEnvelope(this.noise, 0x11)
    }
    this.frameStep = (this.frameStep + 1) & 7
    this.refreshMixer()
  }

  tick(tCycles: number): void {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0) {
      throw new Error('A APU exige uma quantidade inteira e não negativa de T-cycles.')
    }
    for (let elapsed = 0; elapsed < tCycles; elapsed += 1) {
      this.tickCycle()
    }
  }

  /** Um T-cycle interno; canais e amostrador avançam inclusive sem saída de áudio. */
  tickCycle(): void {
    let changed = false
    if (this.powered) {
      changed = this.tickPulse(this.pulse1, 1) || changed
      changed = this.tickPulse(this.pulse2, 6) || changed
      if (this.wave.accessWindow > 0) this.wave.accessWindow -= 1
      if (this.wave.enabled && --this.wave.timer <= 0) {
        const previous = this.waveOutput()
        this.wave.timer = (2048 - this.wave.frequency) * 2
        this.wave.position = (this.wave.position + 1) & 31
        this.wave.sampleBuffer = this.waveRam[this.wave.position >>> 1]!
        this.wave.accessWindow = 2
        changed = this.waveOutput() !== previous || changed
      }
      if (this.noise.enabled && this.registers[0x12]! >>> 4 < 14 && --this.noise.timer <= 0) {
        const previous = this.noise.lfsr & 1
        this.noise.timer = this.noisePeriod()
        const feedback = (this.noise.lfsr ^ (this.noise.lfsr >>> 1)) & 1
        this.noise.lfsr = (this.noise.lfsr >>> 1) | (feedback << 14)
        if ((this.registers[0x12]! & 8) !== 0)
          this.noise.lfsr = (this.noise.lfsr & ~0x40) | (feedback << 6)
        changed = (this.noise.volume !== 0 && (this.noise.lfsr & 1) !== previous) || changed
      }
    }
    if (changed) this.refreshMixer()
    this.sampleSumLeft += this.mixedLeft
    this.sampleSumRight += this.mixedRight
    this.sampleSpan += 1
    this.samplePhase += this.rate
    if (this.samplePhase >= DMG_CLOCK_HZ) {
      this.samplePhase -= DMG_CLOCK_HZ
      this.emitSample()
    }
  }

  clearSamples(): void {
    this.discardSamples()
    this.samplePhase = 0
    this.sampleSpan = 0
    this.sampleSumLeft = 0
    this.sampleSumRight = 0
  }

  /** Descarta apresentação sem alterar a fase de amostragem ou os capacitores. */
  discardSamples(): void {
    this.readFrame = 0
    this.writeFrame = 0
    this.queuedFrames = 0
    this.droppedFrames = 0
  }

  drainSamples(): Float32Array {
    const output = new Float32Array(this.queuedFrames * 2)
    const firstFrames = Math.min(this.queuedFrames, MAX_BUFFERED_FRAMES - this.readFrame)
    output.set(this.samples.subarray(this.readFrame * 2, (this.readFrame + firstFrames) * 2))
    if (firstFrames < this.queuedFrames)
      output.set(this.samples.subarray(0, (this.queuedFrames - firstFrames) * 2), firstFrames * 2)
    this.readFrame = this.writeFrame
    this.queuedFrames = 0
    return output
  }

  snapshot(): ApuSnapshot {
    return {
      powered: this.powered,
      frameSequencerStep: this.frameStep,
      dividerCounter: this.dividerCounter,
      skipNextFrameEvent: this.skipNextFrameEvent,
      registers: this.registers.slice(),
      waveRam: this.waveRam.slice(),
      pulse1: { ...this.pulse1, output: this.pulseOutput(this.pulse1, 1) },
      pulse2: { ...this.pulse2, output: this.pulseOutput(this.pulse2, 6) },
      wave: { ...this.wave, output: this.waveOutput() },
      noise: { ...this.noise, output: this.noiseOutput() },
      sweep: {
        shadow: this.sweepShadow,
        timer: this.sweepTimer,
        enabled: this.sweepEnabled,
        negateUsed: this.sweepNegateUsed,
      },
    }
  }

  snapshotState(): ApuState {
    return {
      version: 1,
      powered: this.powered,
      frameSequencerStep: this.frameStep,
      dividerCounter: this.dividerCounter,
      skipNextFrameEvent: this.skipNextFrameEvent,
      registers: this.registers.slice(),
      waveRam: this.waveRam.slice(),
      pulse1: { ...this.pulse1 },
      pulse2: { ...this.pulse2 },
      wave: { ...this.wave },
      noise: { ...this.noise },
      sweep: {
        shadow: this.sweepShadow,
        timer: this.sweepTimer,
        enabled: this.sweepEnabled,
        negateUsed: this.sweepNegateUsed,
      },
      sampling: {
        rate: this.rate,
        phase: this.samplePhase,
        span: this.sampleSpan,
        sumLeft: this.sampleSumLeft,
        sumRight: this.sampleSumRight,
        capacitorLeft: this.capacitorLeft,
        capacitorRight: this.capacitorRight,
      },
    }
  }

  restoreState(value: unknown): void {
    const state = validateApuState(value)
    this.registers.set(state.registers)
    this.waveRam.set(state.waveRam)
    this.pulse1 = state.pulse1
    this.pulse2 = state.pulse2
    this.wave = state.wave
    this.noise = state.noise
    this.powered = state.powered
    this.frameStep = state.frameSequencerStep
    this.dividerCounter = state.dividerCounter
    this.skipNextFrameEvent = state.skipNextFrameEvent
    this.sweepShadow = state.sweep.shadow
    this.sweepTimer = state.sweep.timer
    this.sweepEnabled = state.sweep.enabled
    this.sweepNegateUsed = state.sweep.negateUsed
    // A fila é apresentação. O resampler e o HPF fazem parte da continuação salva.
    this.setSampleRate(state.sampling.rate)
    this.samplePhase = state.sampling.phase
    this.sampleSpan = state.sampling.span
    this.sampleSumLeft = state.sampling.sumLeft
    this.sampleSumRight = state.sampling.sumRight
    this.capacitorLeft = state.sampling.capacitorLeft
    this.capacitorRight = state.sampling.capacitorRight
    this.refreshMixer()
  }

  private setPower(on: boolean): void {
    if (on === this.powered) return
    this.powered = on
    this.frameStep = 0
    this.skipNextFrameEvent = on && (this.dividerCounter & 0x1000) !== 0
    if (!on) {
      this.registers.fill(0)
      this.pulse1 = pulseState(this.pulse1.length)
      this.pulse2 = pulseState(this.pulse2.length)
      this.wave = waveState(this.wave.length)
      this.noise = noiseState(this.noise.length)
      this.sweepShadow = 0
      this.sweepTimer = 0
      this.sweepEnabled = false
      this.sweepNegateUsed = false
    }
    this.refreshMixer()
  }

  private writeControl(channel: LengthState, value: number, maximum: number): void {
    const nextEnabled = (value & 0x40) !== 0
    const extraClock = (this.frameStep & 1) !== 0
    if (!channel.lengthEnabled && nextEnabled && extraClock && channel.length > 0) {
      channel.length -= 1
      if (channel.length === 0) channel.enabled = false
    }
    channel.lengthEnabled = nextEnabled
    if ((value & 0x80) !== 0 && channel.length === 0) {
      channel.length = maximum - (nextEnabled && extraClock ? 1 : 0)
    }
  }

  private clockLength(channel: LengthState): void {
    if (channel.lengthEnabled && channel.length > 0 && --channel.length === 0)
      channel.enabled = false
  }

  private triggerPulse(channel: PulseState, envelopeOffset: number): void {
    channel.enabled = channel.dacEnabled
    channel.triggered = true
    channel.timer = (2048 - channel.frequency) * 4 + (channel.timer & 3)
    this.triggerEnvelope(channel, envelopeOffset)
  }

  private triggerEnvelope(channel: EnvelopeState, offset: number): void {
    const register = this.registers[offset]!
    channel.volume = register >>> 4
    channel.envelopeTimer = (register & 7 || 8) + (this.frameStep === 7 ? 1 : 0)
    channel.envelopeRunning = true
  }

  private writeEnvelope(channel: EnvelopeState, previous: number, value: number): void {
    if (channel.enabled) {
      if ((previous & 7) === 0 && channel.envelopeRunning) channel.volume += 1
      else if ((previous & 8) === 0) channel.volume += 2
      if (((previous ^ value) & 8) !== 0) channel.volume = 16 - channel.volume
      channel.volume &= 15
    }
    channel.dacEnabled = (value & 0xf8) !== 0
    if (!channel.dacEnabled) channel.enabled = false
  }

  private clockEnvelope(channel: EnvelopeState, offset: number): void {
    if (channel.envelopeTimer > 0) channel.envelopeTimer -= 1
    if (channel.envelopeTimer !== 0) return
    const register = this.registers[offset]!
    channel.envelopeTimer = register & 7 || 8
    if (!channel.envelopeRunning || (register & 7) === 0) return
    const next = channel.volume + ((register & 8) !== 0 ? 1 : -1)
    if (next >= 0 && next <= 15) channel.volume = next
    else channel.envelopeRunning = false
  }

  private triggerSweep(): void {
    const sweep = this.registers[0]!
    this.sweepShadow = this.pulse1.frequency
    this.sweepTimer = (sweep >>> 4) & 7 || 8
    this.sweepEnabled = (sweep & 0x77) !== 0
    this.sweepNegateUsed = false
    if ((sweep & 7) !== 0) this.calculateSweep()
  }

  private calculateSweep(): number {
    const sweep = this.registers[0]!
    const delta = this.sweepShadow >>> (sweep & 7)
    const negate = (sweep & 8) !== 0
    if (negate) this.sweepNegateUsed = true
    const next = this.sweepShadow + (negate ? -delta : delta)
    if (next > 2047) this.pulse1.enabled = false
    return next
  }

  private clockSweep(): void {
    if (this.sweepTimer > 0) this.sweepTimer -= 1
    if (this.sweepTimer !== 0) return
    const pace = (this.registers[0]! >>> 4) & 7
    this.sweepTimer = pace || 8
    if (!this.sweepEnabled || pace === 0) return
    const next = this.calculateSweep()
    if (next <= 2047 && (this.registers[0]! & 7) !== 0) {
      this.sweepShadow = next
      this.pulse1.frequency = next
      this.registers[3] = next & 0xff
      this.registers[4] = (this.registers[4]! & 0xf8) | (next >>> 8)
      this.calculateSweep()
    }
  }

  private triggerWave(): void {
    if (this.wave.enabled && this.wave.timer === 2) {
      const offset = ((this.wave.position + 1) >>> 1) & 15
      if (offset < 4) this.waveRam[0] = this.waveRam[offset]!
      else {
        const aligned = offset & ~3
        for (let index = 0; index < 4; index += 1)
          this.waveRam[index] = this.waveRam[aligned + index]!
      }
    }
    this.wave.enabled = this.wave.dacEnabled
    this.wave.position = 0
    this.wave.timer = (2048 - this.wave.frequency) * 2 + 6
    this.wave.accessWindow = 0
  }

  private tickPulse(channel: PulseState, dutyOffset: number): boolean {
    if (!channel.triggered || --channel.timer > 0) return false
    const previousPosition = channel.dutyPosition
    const wasFirstSample = channel.firstSample
    channel.timer = (2048 - channel.frequency) * 4
    channel.dutyPosition = (channel.dutyPosition + 1) & 7
    channel.firstSample = false
    if (!channel.enabled || channel.volume === 0) return false
    const pattern = DUTY_PATTERNS[this.registers[dutyOffset]! >>> 6]!
    const previous = wasFirstSample ? 0 : (pattern >>> (7 - previousPosition)) & 1
    return previous !== ((pattern >>> (7 - channel.dutyPosition)) & 1)
  }

  private noisePeriod(): number {
    const control = this.registers[0x12]!
    return NOISE_DIVISORS[control & 7]! << (control >>> 4)
  }

  private pulseOutput(channel: PulseState, dutyOffset: number): number {
    if (!channel.enabled || channel.firstSample) return 0
    const duty = this.registers[dutyOffset]! >>> 6
    return ((DUTY_PATTERNS[duty]! >>> (7 - channel.dutyPosition)) & 1) * channel.volume
  }

  private waveOutput(): number {
    if (!this.wave.enabled) return 0
    const level = (this.registers[0x0c]! >>> 5) & 3
    if (level === 0) return 0
    const sample =
      (this.wave.position & 1) !== 0 ? this.wave.sampleBuffer & 15 : this.wave.sampleBuffer >>> 4
    return sample >>> (level - 1)
  }

  private noiseOutput(): number {
    return this.noise.enabled ? (~this.noise.lfsr & 1) * this.noise.volume : 0
  }

  private refreshMixer(): void {
    const pan = this.registers[0x15]!
    const first = this.pulse1.dacEnabled ? 1 - this.pulseOutput(this.pulse1, 1) / 7.5 : 0
    const second = this.pulse2.dacEnabled ? 1 - this.pulseOutput(this.pulse2, 6) / 7.5 : 0
    const third = this.wave.dacEnabled ? 1 - this.waveOutput() / 7.5 : 0
    const fourth = this.noise.dacEnabled ? 1 - this.noiseOutput() / 7.5 : 0
    this.anyDac =
      this.pulse1.dacEnabled ||
      this.pulse2.dacEnabled ||
      this.wave.dacEnabled ||
      this.noise.dacEnabled
    const volume = this.registers[0x14]!
    // Mantém margem de 6 dB para os transientes do filtro e a soma de canais.
    this.mixedLeft =
      (((pan & 0x10 ? first : 0) +
        (pan & 0x20 ? second : 0) +
        (pan & 0x40 ? third : 0) +
        (pan & 0x80 ? fourth : 0)) *
        (((volume >>> 4) & 7) + 1)) /
      64
    this.mixedRight =
      (((pan & 1 ? first : 0) +
        (pan & 2 ? second : 0) +
        (pan & 4 ? third : 0) +
        (pan & 8 ? fourth : 0)) *
        ((volume & 7) + 1)) /
      64
  }

  private emitSample(): void {
    let left = 0
    let right = 0
    if (this.anyDac) {
      const inputLeft = this.sampleSumLeft / this.sampleSpan
      const inputRight = this.sampleSumRight / this.sampleSpan
      left = inputLeft - this.capacitorLeft
      right = inputRight - this.capacitorRight
      this.capacitorLeft = inputLeft - left * this.filterFactor
      this.capacitorRight = inputRight - right * this.filterFactor
    }
    if (this.queuedFrames === MAX_BUFFERED_FRAMES) {
      this.readFrame = (this.readFrame + 1) & (MAX_BUFFERED_FRAMES - 1)
      this.droppedFrames += 1
    } else this.queuedFrames += 1
    this.samples[this.writeFrame * 2] = left
    this.samples[this.writeFrame * 2 + 1] = right
    this.writeFrame = (this.writeFrame + 1) & (MAX_BUFFERED_FRAMES - 1)
    this.sampleSpan = 0
    this.sampleSumLeft = 0
    this.sampleSumRight = 0
  }
}
