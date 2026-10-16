import { AUDIO_MAX_FRAMES } from './protocol'
import type { PcmDiagnostics } from './protocol'

/** Fila fixa de estéreo. O render não cria objetos nem views de arrays. */
export class StereoPcmQueue {
  private readonly samples: Float32Array
  private readFrame = 0
  private writeFrame = 0
  private frames = 0
  private renderedFrames = 0
  private underrunFrames = 0
  private underruns = 0
  private droppedFrames = 0
  private peakLevel = 0
  private energy = 0

  constructor(readonly capacityFrames = AUDIO_MAX_FRAMES) {
    if (!Number.isSafeInteger(capacityFrames) || capacityFrames <= 0)
      throw new RangeError('A capacidade da fila de áudio deve ser um inteiro positivo.')
    this.samples = new Float32Array(capacityFrames * 2)
  }

  get queuedFrames(): number {
    return this.frames
  }

  push(samples: Float32Array): void {
    if (samples.length % 2 !== 0) throw new RangeError('O PCM estéreo exige pares de amostras.')
    const incoming = samples.length / 2
    if (incoming === 0) return
    let start = 0
    if (incoming >= this.capacityFrames) {
      this.droppedFrames += this.frames + incoming - this.capacityFrames
      this.readFrame = 0
      this.writeFrame = 0
      this.frames = 0
      start = incoming - this.capacityFrames
    } else if (this.frames + incoming > this.capacityFrames) {
      const dropped = this.frames + incoming - this.capacityFrames
      this.readFrame = (this.readFrame + dropped) % this.capacityFrames
      this.frames -= dropped
      this.droppedFrames += dropped
    }
    for (let frame = start; frame < incoming; frame += 1) {
      this.samples[this.writeFrame * 2] = samples[frame * 2]!
      this.samples[this.writeFrame * 2 + 1] = samples[frame * 2 + 1]!
      this.writeFrame = (this.writeFrame + 1) % this.capacityFrames
      this.frames += 1
    }
  }

  render(left: Float32Array, right: Float32Array): void {
    left.fill(0)
    right.fill(0)
    const requested = Math.min(left.length, right.length)
    const available = Math.min(this.frames, requested)
    let peak = 0
    for (let frame = 0; frame < available; frame += 1) {
      const rawLeft = this.samples[this.readFrame * 2]!
      const rawRight = this.samples[this.readFrame * 2 + 1]!
      const sampleLeft = Number.isFinite(rawLeft) ? Math.max(-1, Math.min(1, rawLeft)) : 0
      const sampleRight = Number.isFinite(rawRight) ? Math.max(-1, Math.min(1, rawRight)) : 0
      left[frame] = sampleLeft
      right[frame] = sampleRight
      peak = Math.max(peak, Math.abs(sampleLeft), Math.abs(sampleRight))
      this.energy += (sampleLeft * sampleLeft + sampleRight * sampleRight) / 2
      this.readFrame = (this.readFrame + 1) % this.capacityFrames
    }
    this.frames -= available
    this.renderedFrames += available
    this.peakLevel = peak
    if (available < requested) {
      this.underruns += 1
      this.underrunFrames += requested - available
    }
  }

  clear(): void {
    this.readFrame = 0
    this.writeFrame = 0
    this.frames = 0
    this.renderedFrames = 0
    this.underrunFrames = 0
    this.underruns = 0
    this.droppedFrames = 0
    this.peakLevel = 0
    this.energy = 0
  }

  diagnostics(): PcmDiagnostics {
    return {
      queuedFrames: this.frames,
      renderedFrames: this.renderedFrames,
      underrunFrames: this.underrunFrames,
      underruns: this.underruns,
      droppedFrames: this.droppedFrames,
      peakLevel: this.peakLevel,
      energy: this.energy,
    }
  }
}
