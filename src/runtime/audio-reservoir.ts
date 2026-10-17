import { AUDIO_MAX_FRAMES } from '../platform/audio/protocol'

/** PCM produzido pelo clock da máquina, aguardando uma demanda do Worklet. */
export class AudioReservoir {
  private readonly samples: Float32Array
  private readFrame = 0
  private frames = 0
  private produced = 0
  private sent = 0
  private dropped = 0

  constructor(readonly capacityFrames = AUDIO_MAX_FRAMES) {
    if (
      !Number.isSafeInteger(capacityFrames) ||
      capacityFrames < 1 ||
      capacityFrames > AUDIO_MAX_FRAMES
    )
      throw new RangeError(`A capacidade PCM precisa ser inteira, entre 1 e ${AUDIO_MAX_FRAMES}.`)
    this.samples = new Float32Array(capacityFrames * 2)
  }

  get queuedFrames(): number {
    return this.frames
  }

  get producedFrames(): number {
    return this.produced
  }

  get sentFrames(): number {
    return this.sent
  }

  get droppedFrames(): number {
    return this.dropped
  }

  /** Descarta a geração anterior, incluindo os contadores associados. */
  clear(): void {
    this.readFrame = 0
    this.frames = 0
    this.produced = 0
    this.sent = 0
    this.dropped = 0
  }

  reset(): void {
    this.clear()
  }

  /** Não aloca arrays ou views; em overflow mantém somente os frames mais recentes. */
  push(samples: Float32Array): void {
    if (!(samples instanceof Float32Array))
      throw new TypeError('O reservatório PCM exige amostras Float32Array.')
    if (samples.length % 2 !== 0) throw new RangeError('O PCM estéreo exige pares de amostras.')
    const incoming = samples.length / 2
    if (incoming === 0) return
    this.produced += incoming
    let startFrame = 0
    if (incoming >= this.capacityFrames) {
      this.dropped += this.frames + incoming - this.capacityFrames
      this.readFrame = 0
      this.frames = 0
      startFrame = incoming - this.capacityFrames
    } else if (this.frames + incoming > this.capacityFrames) {
      const discarded = this.frames + incoming - this.capacityFrames
      this.dropped += discarded
      this.readFrame = (this.readFrame + discarded) % this.capacityFrames
      this.frames -= discarded
    }
    let writeSample = ((this.readFrame + this.frames) % this.capacityFrames) * 2
    for (let index = startFrame * 2; index < samples.length; index += 1) {
      this.samples[writeSample] = samples[index]!
      writeSample += 1
      if (writeSample === this.samples.length) writeSample = 0
    }
    this.frames += incoming - startFrame
  }

  /** Aloca somente o pacote transferível, sem completar a falta com silêncio. */
  take(maxFrames: number): Float32Array {
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > AUDIO_MAX_FRAMES)
      throw new RangeError(`O pedido PCM precisa ser inteiro, entre 1 e ${AUDIO_MAX_FRAMES}.`)
    const count = Math.min(maxFrames, this.frames)
    const output = new Float32Array(count * 2)
    let readSample = this.readFrame * 2
    for (let index = 0; index < output.length; index += 1) {
      output[index] = this.samples[readSample]!
      readSample += 1
      if (readSample === this.samples.length) readSample = 0
    }
    this.readFrame = (this.readFrame + count) % this.capacityFrames
    this.frames -= count
    this.sent += count
    return output
  }
}
