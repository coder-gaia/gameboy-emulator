export const VIDEO_BUFFER_COUNT = 32
export const VIDEO_FRAME_BYTES = 160 * 144

export interface VideoBufferLease {
  readonly slot: number
  readonly token: number
  readonly framebuffer: Uint8Array<ArrayBuffer>
}

interface VideoBufferSlot {
  bytes: Uint8Array<ArrayBuffer> | null
  token: number
}

/** Arena fixa. Buffers transferidos continuam ocupando seu slot até a devolução. */
export class VideoBufferPool {
  private readonly slots: VideoBufferSlot[] = Array.from({ length: VIDEO_BUFFER_COUNT }, () => ({
    bytes: new Uint8Array(VIDEO_FRAME_BYTES),
    token: 0,
  }))
  private sequence = 0
  private nextSlot = 0

  get allocatedBytes(): number {
    return VIDEO_BUFFER_COUNT * VIDEO_FRAME_BYTES
  }
  get leasedBuffers(): number {
    return this.slots.reduce((count, slot) => count + (slot.bytes === null ? 1 : 0), 0)
  }

  lease(framebuffer: Uint8Array): VideoBufferLease | null {
    if (!(framebuffer instanceof Uint8Array) || framebuffer.length !== VIDEO_FRAME_BYTES)
      throw new RangeError('O quadro de vídeo precisa conter 160 por 144 pixels indexados.')
    for (let offset = 0; offset < this.slots.length; offset += 1) {
      const index = (this.nextSlot + offset) % this.slots.length
      const slot = this.slots[index]!
      if (slot.bytes === null) continue
      if (this.sequence === Number.MAX_SAFE_INTEGER)
        throw new Error('A sequência de buffers de vídeo foi esgotada.')
      const bytes = slot.bytes
      bytes.set(framebuffer)
      slot.bytes = null
      slot.token = ++this.sequence
      this.nextSlot = (index + 1) % this.slots.length
      return { slot: index, token: slot.token, framebuffer: bytes }
    }
    return null
  }

  /** Uma devolução antiga nunca substitui a memória de um empréstimo mais novo. */
  recycle(slotIndex: number, token: number, buffer: ArrayBuffer): boolean {
    if (
      !Number.isSafeInteger(slotIndex) ||
      slotIndex < 0 ||
      slotIndex >= this.slots.length ||
      !Number.isSafeInteger(token)
    )
      return false
    const slot = this.slots[slotIndex]!
    if (
      slot.bytes !== null ||
      token !== slot.token ||
      !(buffer instanceof ArrayBuffer) ||
      buffer.byteLength !== VIDEO_FRAME_BYTES
    )
      return false
    slot.bytes = new Uint8Array(buffer)
    return true
  }
}
