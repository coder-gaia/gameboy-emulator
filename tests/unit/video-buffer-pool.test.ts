import { describe, expect, it } from 'vitest'
import {
  VideoBufferPool,
  VIDEO_BUFFER_COUNT,
  VIDEO_FRAME_BYTES,
} from '../../src/runtime/video-buffer-pool'
import type { VideoBufferLease } from '../../src/runtime/video-buffer-pool'

function transfer(lease: VideoBufferLease): VideoBufferLease {
  return structuredClone(lease, { transfer: [lease.framebuffer.buffer] })
}

describe('pool fixo de imagens transferíveis', () => {
  it('limita a 64 buffers incluindo empréstimos ainda em trânsito e copia a origem', () => {
    const pool = new VideoBufferPool()
    const source = new Uint8Array(VIDEO_FRAME_BYTES).fill(3)
    const leases = Array.from({ length: VIDEO_BUFFER_COUNT }, () => {
      const lease = pool.lease(source)!
      const delivered = transfer(lease)
      expect(lease.framebuffer.byteLength).toBe(0)
      return delivered
    })
    source.fill(1)
    expect(leases[0]!.framebuffer[0]).toBe(3)
    expect(new Set(leases.map((lease) => lease.slot)).size).toBe(64)
    expect(new Set(leases.map((lease) => lease.token)).size).toBe(64)
    expect(pool.leasedBuffers).toBe(64)
    expect(pool.allocatedBytes).toBe(64 * 160 * 144)
    for (let rejected = 0; rejected < 100; rejected += 1) expect(pool.lease(source)).toBeNull()
    expect(pool.allocatedBytes).toBe(1_474_560)
  })

  it('devolve a mesma memória após transferir e impede uma devolução antiga de sobrescrever lease novo', () => {
    const pool = new VideoBufferPool()
    const source = new Uint8Array(VIDEO_FRAME_BYTES)
    const first = transfer(pool.lease(source)!)
    const oldToken = first.token
    expect(pool.recycle(first.slot, first.token, first.framebuffer.buffer)).toBe(true)
    const leases = Array.from({ length: VIDEO_BUFFER_COUNT }, () => pool.lease(source)!)
    const replacement = leases.find((lease) => lease.slot === first.slot)!
    expect(replacement.token).not.toBe(oldToken)
    expect(pool.recycle(first.slot, oldToken, new ArrayBuffer(VIDEO_FRAME_BYTES))).toBe(false)
    expect(pool.leasedBuffers).toBe(64)
    const delivered = transfer(replacement)
    expect(pool.recycle(delivered.slot, delivered.token, delivered.framebuffer.buffer)).toBe(true)
    expect(pool.recycle(delivered.slot, delivered.token, delivered.framebuffer.buffer)).toBe(false)
    expect(pool.leasedBuffers).toBe(63)
  })

  it('recusa slot, token, tamanho, tipo e memória destacada sem perder o empréstimo válido', () => {
    const pool = new VideoBufferPool()
    const lease = pool.lease(new Uint8Array(VIDEO_FRAME_BYTES))!
    const delivered = transfer(lease)
    for (const slot of [-1, VIDEO_BUFFER_COUNT, 0.5, NaN, Infinity])
      expect(pool.recycle(slot, delivered.token, delivered.framebuffer.buffer)).toBe(false)
    for (const token of [-1, 0, delivered.token + 1, 0.5, NaN, Infinity])
      expect(pool.recycle(delivered.slot, token, delivered.framebuffer.buffer)).toBe(false)
    expect(
      pool.recycle(delivered.slot, delivered.token, new ArrayBuffer(VIDEO_FRAME_BYTES - 1)),
    ).toBe(false)
    expect(pool.recycle(delivered.slot, delivered.token, lease.framebuffer.buffer)).toBe(false)
    expect(pool.recycle(delivered.slot, delivered.token, {} as ArrayBuffer)).toBe(false)
    expect(pool.leasedBuffers).toBe(1)
    expect(pool.recycle(delivered.slot, delivered.token, delivered.framebuffer.buffer)).toBe(true)
    for (const size of [0, VIDEO_FRAME_BYTES - 1, VIDEO_FRAME_BYTES + 1])
      expect(() => pool.lease(new Uint8Array(size))).toThrow(/160 por 144/)
  })

  it('reutiliza todos os slots por muitas gerações sem recriar a arena', () => {
    const pool = new VideoBufferPool()
    const source = new Uint8Array(VIDEO_FRAME_BYTES)
    let previousToken = 0
    for (let generation = 0; generation < 12; generation += 1) {
      const leases = Array.from({ length: VIDEO_BUFFER_COUNT }, () => transfer(pool.lease(source)!))
      expect(leases[0]!.token).toBeGreaterThan(previousToken)
      previousToken = leases.at(-1)!.token
      expect(pool.lease(source)).toBeNull()
      for (const lease of leases)
        expect(pool.recycle(lease.slot, lease.token, lease.framebuffer.buffer)).toBe(true)
      expect(pool.leasedBuffers).toBe(0)
      expect(pool.allocatedBytes).toBe(1_474_560)
    }
  })
})
