import { StereoPcmQueue } from './pcm-queue'
import { AUDIO_REFILL_FRAMES, AUDIO_TARGET_FRAMES, isAudioEpoch } from './protocol'
import type { AudioStreamDiagnostics } from './protocol'

/** Estado de consumo testável sem AudioContext nem APIs de Worklet. */
export class PcmStream {
  private readonly queue = new StereoPcmQueue()
  private epoch = 0
  private active = false
  private primed = false
  private pendingFrames = 0

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
    this.queue.clear()
  }

  /** Um pedido pendente impede novas demandas enquanto o Worker prepara o PCM. */
  demand(): number {
    if (!this.active || this.pendingFrames !== 0 || this.queue.queuedFrames >= AUDIO_TARGET_FRAMES)
      return 0
    this.pendingFrames = this.primed
      ? AUDIO_REFILL_FRAMES
      : AUDIO_TARGET_FRAMES - this.queue.queuedFrames
    return this.pendingFrames
  }

  receive(samples: Float32Array, epoch: number): boolean {
    if (
      !this.active ||
      epoch !== this.epoch ||
      this.pendingFrames === 0 ||
      samples.length % 2 !== 0
    )
      return false
    this.pendingFrames = 0
    this.queue.push(samples)
    if (this.queue.queuedFrames >= AUDIO_TARGET_FRAMES) this.primed = true
    return true
  }

  render(left: Float32Array, right: Float32Array): void {
    if (!this.active || !this.primed) {
      left.fill(0)
      right.fill(0)
      return
    }
    this.queue.render(left, right)
  }

  diagnostics(): AudioStreamDiagnostics {
    return {
      ...this.queue.diagnostics(),
      epoch: this.epoch,
      active: this.active,
      primed: this.primed,
      pendingFrames: this.pendingFrames,
    }
  }
}
