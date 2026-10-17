import type { EmulatorVideoFrame } from './worker-protocol'

export const VIDEO_PRESENTATION_CAPACITY = 32

/** Guarda imagens futuras, com o mesmo limite de buffers cedidos pelo Worker. */
export class VideoPresentation {
  private readonly frames: (EmulatorVideoFrame | undefined)[] = Array.from({
    length: VIDEO_PRESENTATION_CAPACITY,
  })
  private head = 0
  private count = 0
  private epoch = -1
  private lastPosition = -1

  constructor(private readonly recycle: (frame: EmulatorVideoFrame) => void) {}

  get size(): number {
    return this.count
  }

  reset(epoch: number): void {
    this.clear()
    this.epoch = epoch
    this.lastPosition = -1
  }

  push(frame: EmulatorVideoFrame): void {
    if (frame.epoch !== this.epoch || frame.pcmFrame < this.lastPosition) {
      this.recycle(frame)
      return
    }
    this.lastPosition = frame.pcmFrame
    if (this.count === VIDEO_PRESENTATION_CAPACITY) this.recycle(this.shift()!)
    this.frames[(this.head + this.count) % VIDEO_PRESENTATION_CAPACITY] = frame
    this.count += 1
  }

  /** A chamada devolve somente a imagem mais recente já alcançada pelo áudio. */
  takeDue(pcmFrame: number): EmulatorVideoFrame | null {
    if (!Number.isFinite(pcmFrame) || pcmFrame < 0) return null
    let selected: EmulatorVideoFrame | null = null
    while (this.count > 0 && this.frames[this.head]!.pcmFrame <= pcmFrame) {
      if (selected) this.recycle(selected)
      selected = this.shift()!
    }
    return selected
  }

  clear(): void {
    while (this.count > 0) this.recycle(this.shift()!)
  }

  private shift(): EmulatorVideoFrame | undefined {
    if (this.count === 0) return undefined
    const frame = this.frames[this.head]
    this.frames[this.head] = undefined
    this.head = (this.head + 1) % VIDEO_PRESENTATION_CAPACITY
    this.count -= 1
    return frame
  }
}
