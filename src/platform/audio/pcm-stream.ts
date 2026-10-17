import { StereoPcmQueue } from './pcm-queue'
import { AUDIO_MAX_REQUEST_FRAMES, audioBufferProfile, isAudioEpoch } from './protocol'
import type { AudioStreamDiagnostics } from './protocol'

/** Estado de consumo testável sem AudioContext nem APIs de Worklet. */
export class PcmStream {
  private readonly queue = new StereoPcmQueue()
  private epoch = 0
  private active = false
  private primed = false
  private pendingFrames = 0
  private readonly profile
  private targetFrames: number
  private elapsedFrames = 0
  private requestedAtFrame = 0
  private roundTripFrames = 0
  private peakRoundTripFrames = 0
  private renderQuantumFrames = 128
  private started = false
  private rebufferFrames = 0
  private rebufferCallbacks = 0

  constructor(sampleRate = 48_000) {
    this.profile = audioBufferProfile(sampleRate)
    this.targetFrames = this.profile.initialFrames
  }

  get currentEpoch(): number {
    return this.epoch
  }

  reset(epoch: number, active: boolean): void {
    if (!isAudioEpoch(epoch))
      throw new RangeError('A geração do áudio deve ser um inteiro não negativo.')
    this.epoch = epoch
    this.active = active
    this.primed = false
    this.pendingFrames = 0
    this.elapsedFrames = 0
    this.requestedAtFrame = 0
    this.roundTripFrames = 0
    this.peakRoundTripFrames = 0
    this.renderQuantumFrames = 128
    this.started = false
    this.rebufferFrames = 0
    this.rebufferCallbacks = 0
    this.targetFrames = this.profile.initialFrames
    this.queue.clear()
  }

  /** Um pedido pendente impede novas demandas enquanto o Worker prepara o PCM. */
  demand(): number {
    if (!this.active || this.pendingFrames !== 0) return 0
    const deficit = this.targetFrames - this.queue.queuedFrames
    if (deficit <= 0 || (this.primed && deficit < this.profile.refillFrames)) return 0
    // Repõe também o consumo previsto enquanto a resposta está em voo.
    // O crédito físico cobre uma resposta que chegue antes do previsto.
    const inFlightConsumption = this.primed ? this.peakRoundTripFrames : 0
    this.pendingFrames = Math.min(
      deficit + inFlightConsumption,
      this.profile.requestLimit,
      AUDIO_MAX_REQUEST_FRAMES - this.queue.queuedFrames,
    )
    this.requestedAtFrame = this.elapsedFrames
    return this.pendingFrames
  }

  receive(samples: Float32Array, epoch: number): boolean {
    if (
      !this.active ||
      epoch !== this.epoch ||
      this.pendingFrames === 0 ||
      samples.length % 2 !== 0 ||
      samples.length / 2 > this.pendingFrames + 128
    )
      return false
    this.roundTripFrames = this.elapsedFrames - this.requestedAtFrame
    this.peakRoundTripFrames = Math.max(this.peakRoundTripFrames, this.roundTripFrames)
    this.targetFrames = Math.min(
      this.profile.maxFrames,
      Math.max(this.targetFrames, this.roundTripFrames * 2 + this.renderQuantumFrames * 2),
    )
    this.pendingFrames = 0
    this.queue.push(samples)
    if (this.queue.queuedFrames >= this.targetFrames) {
      this.primed = true
      this.started = true
    }
    return true
  }

  render(left: Float32Array, right: Float32Array): void {
    if (this.active) {
      this.elapsedFrames += left.length
      this.renderQuantumFrames = Math.max(this.renderQuantumFrames, left.length)
    }
    if (!this.active || !this.primed) {
      if (this.active && this.started) {
        this.rebufferFrames += left.length
        this.rebufferCallbacks += 1
      }
      left.fill(0)
      right.fill(0)
      return
    }
    const starved = this.queue.queuedFrames < left.length
    this.queue.render(left, right)
    if (starved) this.primed = false
  }

  diagnostics(): AudioStreamDiagnostics {
    const pcm = this.queue.diagnostics()
    return {
      ...pcm,
      underrunFrames: pcm.underrunFrames + this.rebufferFrames,
      underruns: pcm.underruns + this.rebufferCallbacks,
      epoch: this.epoch,
      active: this.active,
      primed: this.primed,
      pendingFrames: this.pendingFrames,
      targetFrames: this.targetFrames,
      roundTripFrames: this.roundTripFrames,
      peakRoundTripFrames: this.peakRoundTripFrames,
      renderQuantumFrames: this.renderQuantumFrames,
    }
  }
}
