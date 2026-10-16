import { DMG_CLOCK_HZ, DMG_FRAME_T_CYCLES } from '../core/model'

export interface CycleRunner {
  runCycles(budget: number): number
}
export interface AnimationClock {
  request(callback: (timestamp: number) => void): number
  cancel(handle: number): void
}

/** Relógio monotônico até a APU assumir a cadência. RAF só fornece apresentações. */
export class BrowserPlayback {
  private active = false
  private handle = 0
  private previous: number | null = null
  private debt = 0

  constructor(
    private readonly runner: CycleRunner,
    private readonly present: () => void,
    private readonly onError: (error: Error) => void,
    private readonly clock: AnimationClock = {
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (handle) => window.cancelAnimationFrame(handle),
    },
  ) {}

  start(): void {
    if (this.active) return
    this.active = true
    this.previous = null
    this.debt = 0
    this.handle = this.clock.request(this.frame)
  }

  pause(): void {
    this.active = false
    this.clock.cancel(this.handle)
    this.previous = null
    this.debt = 0
  }

  private frame = (timestamp: number): void => {
    if (!this.active) return
    try {
      if (this.previous !== null) {
        const elapsed = Math.max(0, Math.min(timestamp - this.previous, 100))
        this.debt = Math.min(this.debt + (elapsed * DMG_CLOCK_HZ) / 1000, DMG_FRAME_T_CYCLES * 4)
        if (this.debt >= 1) this.debt -= this.runner.runCycles(Math.floor(this.debt))
      }
      this.previous = timestamp
      this.present()
      this.handle = this.clock.request(this.frame)
    } catch (cause) {
      this.pause()
      this.onError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }
}
