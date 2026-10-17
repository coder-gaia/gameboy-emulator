import { describe, expect, it } from 'vitest'
import { StereoPcmQueue } from '../../src/platform/audio/pcm-queue'
import { PcmStream } from '../../src/platform/audio/pcm-stream'
import { AUDIO_REFILL_FRAMES, AUDIO_TARGET_FRAMES } from '../../src/platform/audio/protocol'

function stereo(frames: number, left = 0.25, right = -0.5): Float32Array {
  const samples = new Float32Array(frames * 2)
  for (let frame = 0; frame < frames; frame += 1) {
    samples[frame * 2] = left
    samples[frame * 2 + 1] = right
  }
  return samples
}

describe('fila PCM estéreo', () => {
  it('preserva canais e ordem ao atravessar o fim do buffer circular', () => {
    const queue = new StereoPcmQueue(4)
    queue.push(new Float32Array([0.1, -0.1, 0.2, -0.2, 0.3, -0.3]))
    const left = new Float32Array(2)
    const right = new Float32Array(2)
    queue.render(left, right)
    expect(left).toEqual(new Float32Array([0.1, 0.2]))
    expect(right).toEqual(new Float32Array([-0.1, -0.2]))
    queue.push(new Float32Array([0.4, -0.4, 0.5, -0.5, 0.6, -0.6]))
    const wrappedLeft = new Float32Array(4)
    const wrappedRight = new Float32Array(4)
    queue.render(wrappedLeft, wrappedRight)
    expect(wrappedLeft).toEqual(new Float32Array([0.3, 0.4, 0.5, 0.6]))
    expect(wrappedRight).toEqual(new Float32Array([-0.3, -0.4, -0.5, -0.6]))
    expect(queue.queuedFrames).toBe(0)
  })

  it('preenche falta de PCM com silêncio sem repetir áudio antigo', () => {
    const queue = new StereoPcmQueue(4)
    queue.push(stereo(1))
    const left = new Float32Array(4).fill(0.9)
    const right = new Float32Array(4).fill(0.9)
    queue.render(left, right)
    expect(left).toEqual(new Float32Array([0.25, 0, 0, 0]))
    expect(right).toEqual(new Float32Array([-0.5, 0, 0, 0]))
    expect(queue.diagnostics()).toMatchObject({
      renderedFrames: 1,
      underrunFrames: 3,
      underruns: 1,
    })
    queue.render(left, right)
    expect(left).toEqual(new Float32Array(4))
    expect(right).toEqual(new Float32Array(4))
    expect(queue.diagnostics()).toMatchObject({ underrunFrames: 7, underruns: 2 })
  })

  it('descarta os frames mais antigos quando a fila fica cheia', () => {
    const queue = new StereoPcmQueue(4)
    queue.push(stereo(3, 0.25, -0.25))
    queue.push(stereo(3, 0.5, -0.5))
    expect(queue.queuedFrames).toBe(4)
    expect(queue.diagnostics().droppedFrames).toBe(2)
    const left = new Float32Array(4)
    const right = new Float32Array(4)
    queue.render(left, right)
    expect(left).toEqual(new Float32Array([0.25, 0.5, 0.5, 0.5]))
    expect(right).toEqual(new Float32Array([-0.25, -0.5, -0.5, -0.5]))
  })

  it('pacote maior que a capacidade conserva somente seu final e conta todo descarte', () => {
    const queue = new StereoPcmQueue(4)
    queue.push(stereo(2))
    queue.push(new Float32Array([0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4, 0.5, -0.5, 0.6, -0.6]))
    expect(queue.diagnostics().droppedFrames).toBe(4)
    const left = new Float32Array(4)
    queue.render(left, new Float32Array(4))
    expect(left).toEqual(new Float32Array([0.3, 0.4, 0.5, 0.6]))
  })

  it('copia o pacote e limita amostras inválidas antes de entregar ao navegador', () => {
    const queue = new StereoPcmQueue(4)
    const samples = new Float32Array([2, -2, Number.NaN, Number.POSITIVE_INFINITY])
    queue.push(samples)
    samples.fill(0)
    const left = new Float32Array(2)
    const right = new Float32Array(2)
    queue.render(left, right)
    expect(left).toEqual(new Float32Array([1, 0]))
    expect(right).toEqual(new Float32Array([-1, 0]))
    expect(queue.diagnostics()).toMatchObject({ peakLevel: 1, energy: 1 })
  })

  it('limpa conteúdo e métricas entre sessões sem redimensionar a fila', () => {
    const queue = new StereoPcmQueue(4)
    queue.push(stereo(6))
    queue.render(new Float32Array(8), new Float32Array(8))
    queue.clear()
    expect(queue.diagnostics()).toEqual({
      queuedFrames: 0,
      renderedFrames: 0,
      underrunFrames: 0,
      underruns: 0,
      droppedFrames: 0,
      peakLevel: 0,
      energy: 0,
    })
    expect(queue.capacityFrames).toBe(4)
  })

  it('aceita quanta diferentes sem assumir 128 frames fixos', () => {
    const queue = new StereoPcmQueue(512)
    queue.push(stereo(512))
    queue.render(new Float32Array(96), new Float32Array(96))
    queue.render(new Float32Array(256), new Float32Array(256))
    expect(queue.queuedFrames).toBe(160)
    expect(queue.diagnostics().underruns).toBe(0)
  })

  it('recusa pacote sem par estéreo e capacidade inválida', () => {
    expect(() => new StereoPcmQueue(0)).toThrow(/capacidade/)
    expect(() => new StereoPcmQueue().push(new Float32Array(3))).toThrow(/pares/)
  })
})

describe('consumo dirigido pelo AudioWorklet', () => {
  it('conectar pausado não pede ciclos e resume cria só uma demanda pendente', () => {
    const stream = new PcmStream()
    stream.reset(1, false)
    expect(stream.demand()).toBe(0)
    stream.reset(2, true)
    expect(stream.demand()).toBe(AUDIO_TARGET_FRAMES)
    expect(stream.demand()).toBe(0)
    expect(stream.diagnostics().pendingFrames).toBe(AUDIO_TARGET_FRAMES)
  })

  it('aguarda o buffer inicial sem registrar underrun de inicialização', () => {
    const stream = new PcmStream()
    stream.reset(1, true)
    stream.demand()
    const left = new Float32Array(128).fill(1)
    const right = new Float32Array(128).fill(1)
    stream.render(left, right)
    expect(left).toEqual(new Float32Array(128))
    expect(stream.diagnostics().underruns).toBe(0)
    stream.receive(stereo(512), 1)
    expect(stream.diagnostics().primed).toBe(false)
    expect(stream.demand()).toBe(AUDIO_TARGET_FRAMES - 512)
    stream.receive(stereo(AUDIO_TARGET_FRAMES - 512), 1)
    stream.render(left, right)
    expect(left).toEqual(new Float32Array(128).fill(0.25))
    expect(right).toEqual(new Float32Array(128).fill(-0.5))
    expect(stream.demand()).toBe(0)
    stream.render(
      new Float32Array(AUDIO_REFILL_FRAMES - 128),
      new Float32Array(AUDIO_REFILL_FRAMES - 128),
    )
    expect(stream.demand()).toBe(AUDIO_REFILL_FRAMES + 128)
  })

  it('descarta PCM em voo da geração anterior ao pausar e retomar', () => {
    const stream = new PcmStream()
    stream.reset(1, true)
    stream.demand()
    stream.reset(2, false)
    expect(stream.receive(stereo(AUDIO_TARGET_FRAMES), 1)).toBe(false)
    expect(stream.demand()).toBe(0)
    stream.reset(3, true)
    stream.demand()
    expect(stream.receive(stereo(AUDIO_TARGET_FRAMES), 1)).toBe(false)
    expect(stream.receive(stereo(AUDIO_TARGET_FRAMES, 0.5, -0.25), 3)).toBe(true)
    const left = new Float32Array(128)
    stream.render(left, new Float32Array(128))
    expect(left).toEqual(new Float32Array(128).fill(0.5))
    expect(stream.diagnostics().epoch).toBe(3)
  })

  it('recusa respostas duplicadas e mantém demanda atual após pacote inválido', () => {
    const stream = new PcmStream()
    stream.reset(1, true)
    stream.demand()
    expect(stream.receive(new Float32Array(3), 1)).toBe(false)
    expect(stream.demand()).toBe(0)
    expect(stream.receive(stereo(AUDIO_TARGET_FRAMES), 1)).toBe(true)
    expect(stream.receive(stereo(AUDIO_TARGET_FRAMES), 1)).toBe(false)
    expect(stream.diagnostics().queuedFrames).toBe(AUDIO_TARGET_FRAMES)
  })

  it('contabiliza falta real após começar a tocar e consegue se recuperar', () => {
    const stream = new PcmStream()
    stream.reset(1, true)
    stream.demand()
    stream.receive(stereo(AUDIO_TARGET_FRAMES), 1)
    for (let offset = 0; offset < AUDIO_TARGET_FRAMES + 128; offset += 128)
      stream.render(new Float32Array(128), new Float32Array(128))
    expect(stream.diagnostics()).toMatchObject({ underruns: 1, underrunFrames: 128 })
    expect(stream.demand()).toBe(AUDIO_TARGET_FRAMES)
    stream.receive(stereo(AUDIO_TARGET_FRAMES), 1)
    const left = new Float32Array(128)
    stream.render(left, new Float32Array(128))
    expect(left).toEqual(new Float32Array(128).fill(0.25))
  })
})
