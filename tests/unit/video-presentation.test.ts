import { describe, expect, it } from 'vitest'
import {
  VideoPresentation,
  VIDEO_PRESENTATION_CAPACITY,
} from '../../src/runtime/video-presentation'
import type { EmulatorVideoFrame } from '../../src/runtime/worker-protocol'

function frame(token: number, pcmFrame: number, epoch = 1): EmulatorVideoFrame {
  return {
    epoch,
    slot: token % VIDEO_PRESENTATION_CAPACITY,
    token,
    pcmFrame,
    frameId: token,
    framebuffer: new Uint8Array(160 * 144),
  }
}

function setup() {
  const recycled: EmulatorVideoFrame[] = []
  const queue = new VideoPresentation((image) => recycled.push(image))
  queue.reset(1)
  return { queue, recycled }
}

describe('apresentação guiada pelo PCM consumido', () => {
  it('preserva imagens futuras até o instante correspondente, incluindo o limite exato', () => {
    const { queue, recycled } = setup()
    const first = frame(1, 800)
    const second = frame(2, 1600)
    queue.push(first)
    queue.push(second)
    expect(queue.takeDue(799)).toBeNull()
    expect(queue.size).toBe(2)
    expect(queue.takeDue(800)).toBe(first)
    expect(queue.takeDue(1599)).toBeNull()
    expect(queue.takeDue(1600)).toBe(second)
    expect(queue.takeDue(2000)).toBeNull()
    expect(recycled).toEqual([])
  })

  it('recupera somente a imagem vencida mais recente e devolve buffers ultrapassados', () => {
    const { queue, recycled } = setup()
    const frames = [frame(1, 800), frame(2, 1600), frame(3, 2400), frame(4, 3200)]
    for (const image of frames) queue.push(image)
    expect(queue.takeDue(2500)).toBe(frames[2])
    expect(recycled).toEqual(frames.slice(0, 2))
    expect(queue.size).toBe(1)
    expect(queue.takeDue(3199)).toBeNull()
  })

  it('aceita mudanças do LCD no mesmo frame e na mesma posição PCM', () => {
    const { queue, recycled } = setup()
    const first = frame(1, 800)
    const blank = { ...frame(2, 800), frameId: first.frameId }
    queue.push(first)
    queue.push(blank)
    expect(queue.takeDue(800)).toBe(blank)
    expect(recycled).toEqual([first])
  })

  it('descarta epochs antigas sem devolver uma imagem da sessão anterior', () => {
    const { queue, recycled } = setup()
    const old = frame(1, 800)
    queue.push(old)
    queue.reset(2)
    const delayed = frame(2, 1600)
    queue.push(delayed)
    const fresh = frame(3, 700, 2)
    queue.push(fresh)
    expect(recycled).toEqual([old, delayed])
    expect(queue.takeDue(800)).toBe(fresh)
  })

  it('rejeita chegada fora de ordem sem prender seu buffer', () => {
    const { queue, recycled } = setup()
    const current = frame(1, 1600)
    const late = frame(2, 800)
    queue.push(current)
    queue.push(late)
    expect(recycled).toEqual([late])
    expect(queue.takeDue(1600)).toBe(current)
  })

  it('permanece limitada mesmo quando a apresentação não consome imagens', () => {
    const { queue, recycled } = setup()
    for (let token = 0; token < 1000; token += 1) {
      queue.push(frame(token, token * 800))
      expect(queue.size).toBeLessThanOrEqual(VIDEO_PRESENTATION_CAPACITY)
    }
    expect(recycled.length).toBe(1000 - VIDEO_PRESENTATION_CAPACITY)
    const latest = queue.takeDue(1_000_000)
    expect(latest?.token).toBe(999)
    expect(recycled.length).toBe(999)
    expect(new Set(recycled.map((image) => image.token)).size).toBe(999)
  })

  it('limpa pausa ou descarte e pode receber novos buffers sem referências antigas', () => {
    const { queue, recycled } = setup()
    const pending = [frame(1, 800), frame(2, 1600)]
    pending.forEach((image) => queue.push(image))
    queue.clear()
    queue.clear()
    expect(queue.size).toBe(0)
    expect(recycled).toEqual(pending)
    expect(queue.takeDue(10_000)).toBeNull()
  })

  it.each([NaN, Infinity, -1])('não antecipa imagens para cursor inválido %s', (cursor) => {
    const { queue } = setup()
    queue.push(frame(1, 800))
    expect(queue.takeDue(cursor)).toBeNull()
    expect(queue.size).toBe(1)
  })
})
