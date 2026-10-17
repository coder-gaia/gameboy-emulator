export const PLAYBACK_TIMELINE_CAPACITY = 512

const FRAME_EPSILON = 0.0001

/** Trechos do relógio do grafo que ainda podem estar a caminho da saída física. */
export class PlaybackTimeline {
  private readonly times = new Float64Array(PLAYBACK_TIMELINE_CAPACITY)
  private readonly frames = new Float64Array(PLAYBACK_TIMELINE_CAPACITY)
  private readonly moving = new Uint8Array(PLAYBACK_TIMELINE_CAPACITY)
  private head = 0
  private count = 0
  private sampleRate = 48_000
  private previousTime = 0
  private previousFrame = 0
  private received = false

  get size(): number {
    return this.count
  }

  reset(sampleRate = 48_000): void {
    this.head = 0
    this.count = 0
    this.sampleRate = sampleRate
    this.previousTime = 0
    this.previousFrame = 0
    this.received = false
  }

  record(contextTime: number, frame: number, advancing: boolean): void {
    if (this.received && contextTime > this.previousTime) {
      const advanced = frame - this.previousFrame
      const elapsedFrames = (contextTime - this.previousTime) * this.sampleRate
      if (advanced <= elapsedFrames + FRAME_EPSILON) {
        // O render consome primeiro o PCM disponível e completa a falta com silêncio.
        // Fechar esse trecho não altera o que ainda não chegou à saída física.
        this.append(this.previousTime, this.previousFrame, advanced > 0)
        const end = Math.min(contextTime, this.previousTime + advanced / this.sampleRate)
        if (elapsedFrames - advanced > FRAME_EPSILON) this.append(end, frame, false)
      }
      // Um salto lógico de PCM, por descarte, só entra no instante informado.
    }
    this.append(contextTime, frame, advancing)
    this.previousTime = contextTime
    this.previousFrame = frame
    this.received = true
  }

  frameAt(contextTime: number): number {
    if (this.count === 0) return 0
    let offset = this.count - 1
    while (offset > 0 && this.times[this.index(offset)]! > contextTime) offset -= 1
    const index = this.index(offset)
    const frame =
      this.frames[index]! +
      (this.moving[index] ? (contextTime - this.times[index]!) * this.sampleRate : 0)
    // Conserva a âncora do trecho consultado e todos os trechos futuros.
    this.head = index
    this.count -= offset
    return Math.max(0, frame)
  }

  private append(contextTime: number, frame: number, advancing: boolean): void {
    if (this.count > 0) {
      const last = this.index(this.count - 1)
      if (this.times[last] === contextTime) {
        this.frames[last] = frame
        this.moving[last] = Number(advancing)
        return
      }
      const expected =
        this.frames[last]! +
        (this.moving[last] ? (contextTime - this.times[last]!) * this.sampleRate : 0)
      if (this.moving[last] === Number(advancing) && Math.abs(expected - frame) <= FRAME_EPSILON)
        return
    }
    if (this.count === PLAYBACK_TIMELINE_CAPACITY) {
      this.head = this.index(1)
      this.count -= 1
    }
    const index = this.index(this.count)
    this.times[index] = contextTime
    this.frames[index] = frame
    this.moving[index] = Number(advancing)
    this.count += 1
  }

  private index(offset: number): number {
    return (this.head + offset) % PLAYBACK_TIMELINE_CAPACITY
  }
}
