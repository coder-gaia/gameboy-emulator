import { describe, expect, it, vi } from 'vitest'
import { AudioOutput } from '../../src/platform/audio/audio-output'
import type { AudioControlMessage, AudioPlaybackMessage } from '../../src/platform/audio/protocol'

function fakeAudio() {
  const gain = { gain: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
  const node = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onprocessorerror: null as (() => void) | null,
    port: {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn<(message: AudioControlMessage, transfer: Transferable[]) => void>(),
      close: vi.fn(),
    },
  }
  const context = {
    sampleRate: 48_000,
    currentTime: 0,
    state: 'suspended' as AudioContextState,
    onstatechange: null as (() => void) | null,
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createGain: vi.fn(() => gain),
    resume: vi.fn(async () => {
      context.state = 'running'
    }),
    suspend: vi.fn(async () => {
      context.state = 'suspended'
    }),
    close: vi.fn(async () => {
      context.state = 'closed'
    }),
  }
  const nodeFactory = vi.fn(() => node as unknown as AudioWorkletNode)
  const contextFactory = vi.fn(() => context as unknown as AudioContext)
  return { context, node, gain, options: { nodeFactory, contextFactory } }
}

function playback(
  fake: ReturnType<typeof fakeAudio>,
  overrides: Partial<AudioPlaybackMessage> = {},
): void {
  const message: AudioPlaybackMessage = {
    type: 'playback',
    epoch: 1,
    frame: 512,
    availableFrame: 4096,
    contextTime: 10,
    advancing: true,
    ...overrides,
  }
  fake.node.port.onmessage?.({ data: message } as MessageEvent)
}

describe('saída AudioContext e AudioWorklet', () => {
  it('resume no gesto, antes de aguardar módulo, e reutiliza a preparação em andamento', async () => {
    const fake = fakeAudio()
    let finishModule!: () => void
    fake.context.audioWorklet.addModule.mockReturnValue(
      new Promise<void>((resolve) => {
        finishModule = resolve
      }),
    )
    const output = new AudioOutput(fake.options)
    const preparing = output.prepare()
    expect(fake.context.resume).toHaveBeenCalledOnce()
    expect(fake.options.nodeFactory).not.toHaveBeenCalled()
    expect(output.prepare()).toBe(preparing)
    finishModule()
    expect(await preparing).toBe(48_000)
    expect(fake.options.nodeFactory).toHaveBeenCalledWith(fake.context, 'pocket-lab-pcm', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    expect(fake.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    await output.dispose()
  })

  it('transfere port pausado e usa epochs novos ao retomar e pausar', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    const port = {} as MessagePort
    output.connect(port, 1)
    expect(fake.node.port.postMessage).toHaveBeenLastCalledWith(
      { type: 'connect', port, epoch: 1 },
      [port],
    )
    expect(output.getDiagnostics().active).toBe(false)
    await output.resume(2)
    expect(fake.node.port.postMessage).toHaveBeenLastCalledWith(
      { type: 'reset', epoch: 2, active: true },
      [],
    )
    expect(fake.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.7, 0)
    await output.pause(3)
    expect(fake.node.port.postMessage).toHaveBeenLastCalledWith(
      { type: 'reset', epoch: 3, active: false },
      [],
    )
    expect(fake.context.suspend).toHaveBeenCalledOnce()
    expect(output.getDiagnostics()).toMatchObject({
      active: false,
      queuedFrames: 0,
      renderedFrames: 0,
    })
    await output.dispose()
  })

  it('mute mantém clock ativo e volume reaparece ao desmutar', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    output.setVolume(0.4)
    output.setMuted(true)
    expect(fake.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    expect(output.getDiagnostics()).toMatchObject({ active: true, muted: true, volume: 0.4 })
    expect(fake.context.suspend).not.toHaveBeenCalled()
    output.setMuted(false)
    expect(fake.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.4, 0)
    await output.dispose()
  })

  it('ignora métricas da geração anterior depois do reset', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(2)
    const current = output.getDiagnostics()
    fake.node.port.onmessage?.({
      data: { type: 'stats', diagnostics: { ...current, epoch: 1, renderedFrames: 999 } },
    } as MessageEvent)
    expect(output.getDiagnostics().renderedFrames).toBe(0)
    fake.node.port.onmessage?.({
      data: {
        type: 'stats',
        diagnostics: { ...current, epoch: 2, renderedFrames: 512, energy: 4 },
      },
    } as MessageEvent)
    expect(output.getDiagnostics()).toMatchObject({ renderedFrames: 512, energy: 4 })
    await output.dispose()
  })

  it('encerra nós, port e contexto uma vez e rejeita preparar a instância encerrada', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    await output.dispose()
    await output.dispose()
    expect(fake.node.disconnect).toHaveBeenCalledOnce()
    expect(fake.node.port.close).toHaveBeenCalledOnce()
    expect(fake.gain.disconnect).toHaveBeenCalledOnce()
    expect(fake.context.close).toHaveBeenCalledOnce()
    await expect(output.prepare()).rejects.toThrow('encerrada')
  })

  it('dispose durante carregamento não cria nós após encerrar a instância', async () => {
    const fake = fakeAudio()
    let finishModule!: () => void
    fake.context.audioWorklet.addModule.mockReturnValue(
      new Promise<void>((resolve) => {
        finishModule = resolve
      }),
    )
    const output = new AudioOutput(fake.options)
    const preparing = output.prepare()
    const failed = expect(preparing).rejects.toThrow('encerrada')
    await output.dispose()
    finishModule()
    await failed
    expect(fake.options.nodeFactory).not.toHaveBeenCalled()
    expect(fake.context.close).toHaveBeenCalledOnce()
  })

  it('falha ao carregar o Worklet libera contexto e entrega mensagem útil', async () => {
    const fake = fakeAudio()
    fake.context.audioWorklet.addModule.mockRejectedValue(
      new Error('Falha ao carregar o módulo de áudio'),
    )
    const output = new AudioOutput(fake.options)
    await expect(output.prepare()).rejects.toThrow('módulo de áudio')
    expect(fake.context.close).toHaveBeenCalledOnce()
    expect(output.getDiagnostics().error).toContain('módulo de áudio')
  })

  it('erro do processador silencia imediatamente e informa o cliente', async () => {
    const fake = fakeAudio()
    const onError = vi.fn()
    const output = new AudioOutput({ ...fake.options, onError })
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    fake.node.onprocessorerror?.()
    expect(fake.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    expect(output.getDiagnostics().active).toBe(false)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('interrompida') }),
    )
    await output.dispose()
  })

  it('interrupção inesperada informa o cliente sem afetar a pausa normal', async () => {
    const fake = fakeAudio()
    const onError = vi.fn()
    const output = new AudioOutput({ ...fake.options, onError })
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    fake.context.state = 'suspended'
    fake.context.onstatechange?.()
    expect(onError).toHaveBeenCalledOnce()
    expect(output.getDiagnostics().active).toBe(false)
    expect(fake.node.port.postMessage).toHaveBeenLastCalledWith(
      { type: 'reset', epoch: 1, active: false },
      [],
    )
    await output.resume(2)
    await output.pause(3)
    fake.context.onstatechange?.()
    expect(onError).toHaveBeenCalledOnce()
    await output.dispose()
    expect(fake.context.onstatechange).toBeNull()
  })

  it('recusa volume fora do intervalo, geração inválida e uso antes de preparar', async () => {
    const output = new AudioOutput()
    expect(() => output.setVolume(Number.NaN)).toThrow(/volume/)
    expect(() => output.setVolume(1.1)).toThrow(/volume/)
    expect(() => output.connect({} as MessagePort, 1)).toThrow(/Prepare/)
    await expect(output.pause(-1)).rejects.toThrow(/geração/)
    await output.dispose()
  })

  it('suspend ainda em voo não informa erro se o usuário já pediu resume', async () => {
    const fake = fakeAudio()
    const onError = vi.fn()
    const output = new AudioOutput({ ...fake.options, onError })
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    let finishSuspend!: () => void
    fake.context.suspend.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSuspend = resolve
      }),
    )
    const pausing = output.pause(2)
    const resuming = output.resume(3)
    fake.context.state = 'suspended'
    fake.context.onstatechange?.()
    expect(onError).not.toHaveBeenCalled()
    fake.context.state = 'running'
    finishSuspend()
    await Promise.all([pausing, resuming])
    expect(output.getDiagnostics()).toMatchObject({ active: true, epoch: 3 })
    await output.dispose()
  })
})

describe('cursor de reprodução para apresentação de vídeo', () => {
  it('correlaciona saída e página, aceita delta negativo e limita a posição final ao PCM conhecido', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn(() => ({ contextTime: 10, performanceTime: 5000 }))
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const now = vi.spyOn(performance, 'now').mockReturnValue(5010)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10.1
      playback(fake, { contextTime: 10.02 })
      expect(timestamp).toHaveBeenCalledOnce()
      expect(output.getPlaybackFrame(1)).toBeCloseTo(32)
      now.mockReturnValue(5000)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(32)
      now.mockReturnValue(5030)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
      now.mockReturnValue(6000)
      expect(output.getPlaybackFrame(1)).toBe(4096)
      expect(timestamp).toHaveBeenCalledOnce()
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('o cursor correlato avança entre RAFs mesmo quando currentTime mantém o mesmo quantum', async () => {
    const fake = fakeAudio()
    Object.assign(fake.context, {
      getOutputTimestamp: () => ({ contextTime: 9.99, performanceTime: 5000 }),
      baseLatency: 0.8,
      outputLatency: 0.9,
    })
    const now = vi.spyOn(performance, 'now').mockReturnValue(5010)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10
      playback(fake)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(512)
      now.mockReturnValue(5026)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(1280)
      expect(fake.context.currentTime).toBe(10)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it.each([
    undefined,
    {},
    { contextTime: 10, performanceTime: 0 },
    { contextTime: -1, performanceTime: 5000 },
    { contextTime: 10, performanceTime: Number.NaN },
    { contextTime: Number.POSITIVE_INFINITY, performanceTime: 5000 },
  ])('usa currentTime se a estimativa de saída não é válida: %o', async (timestamp) => {
    const fake = fakeAudio()
    Object.assign(fake.context, { getOutputTimestamp: () => timestamp })
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    fake.context.currentTime = 10.01
    expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
    await output.dispose()
  })

  it('usa currentTime quando a API de saída lança erro ou performance.now é inválido', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn(() => ({ contextTime: 10, performanceTime: 5000 }))
    timestamp.mockImplementationOnce(() => {
      throw new Error('Saída ainda indisponível')
    })
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const output = new AudioOutput(fake.options)
    const now = vi.spyOn(performance, 'now').mockReturnValue(Number.NaN)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      playback(fake)
      fake.context.currentTime = 10.01
      expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
      playback(fake)
      expect(timestamp).toHaveBeenCalledOnce()
      expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
      now.mockReturnValue(-1)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('consulta o trecho de rebuffer no instante de saída e limpa o histórico no reset', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn(() => ({ contextTime: 10, performanceTime: 5000 }))
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const now = vi.spyOn(performance, 'now').mockReturnValue(5010)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10.01
      playback(fake, { frame: 1024, availableFrame: 1024, advancing: false })
      now.mockReturnValue(6000)
      expect(output.getPlaybackFrame(1)).toBe(1024)
      timestamp.mockReturnValue({ contextTime: 11, performanceTime: 6000 })
      playback(fake, { frame: 1024, availableFrame: 4096, contextTime: 11 })
      now.mockReturnValue(6010)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(1504)
      await output.pause(2)
      expect(output.getPlaybackFrame(2)).toBeNull()
      await output.resume(3)
      expect(output.getPlaybackFrame(3)).toBeNull()
      timestamp.mockReturnValue({ contextTime: 12, performanceTime: 7000 })
      playback(fake, { epoch: 3, frame: 0, contextTime: 12 })
      now.mockReturnValue(7010)
      expect(output.getPlaybackFrame(3)).toBeCloseTo(480)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('preserva cadência com 312 ms de saída ao esvaziar e retomar a fila', async () => {
    const fake = fakeAudio()
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    Object.assign(fake.context, {
      baseLatency: 0.12825,
      outputLatency: 0.312,
      getOutputTimestamp: () => ({
        contextTime: fake.context.currentTime - 0.312,
        performanceTime: performance.now(),
      }),
    })
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10
      playback(fake, { frame: 0, availableFrame: 3072, contextTime: 9 })
      playback(fake, {
        frame: 47_872,
        availableFrame: 48_000,
        contextTime: 10 - 128 / 48_000,
      })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(33_024)
      expect(output.getDiagnostics().playback).toMatchObject({
        clockMode: 'output',
        graphPcmFrame: 47_872,
        graphContextTimeSeconds: 10 - 128 / 48_000,
        outputContextTimeSeconds: 9.688,
        outputPerformanceTimeMilliseconds: 10_000,
      })
      expect(output.getDiagnostics().playback.pcmFrame).toBeCloseTo(33_024)
      playback(fake, {
        frame: 48_000,
        availableFrame: 48_000,
        contextTime: 10,
        advancing: false,
      })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(33_024)

      fake.context.currentTime = 10 + 128 / 48_000
      now.mockReturnValue(10_000 + 128 / 48)
      playback(fake, {
        frame: 48_000,
        availableFrame: 64_000,
        contextTime: fake.context.currentTime,
      })
      let previous = output.getPlaybackFrame(1)!
      expect(previous).toBeCloseTo(33_152)
      let advancingSteps = 0
      for (let quantum = 2; quantum <= 180; quantum += 1) {
        now.mockReturnValue(10_000 + (quantum * 128) / 48)
        const position = output.getPlaybackFrame(1)!
        expect(position).toBeGreaterThanOrEqual(previous)
        expect(position - previous).toBeLessThanOrEqual(128.0001)
        if (position > previous + 0.001) advancingSteps += 1
        previous = position
      }
      expect(advancingSteps).toBeGreaterThanOrEqual(177)
      expect(previous).toBeCloseTo(55_936)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('silêncio no grafo só congela o cursor quando esse trecho chega à saída', async () => {
    const fake = fakeAudio()
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    Object.assign(fake.context, {
      getOutputTimestamp: () => ({
        contextTime: fake.context.currentTime - 0.312,
        performanceTime: performance.now(),
      }),
    })
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10
      playback(fake, { frame: 0, availableFrame: 3072, contextTime: 9 })
      playback(fake, {
        frame: 48_000,
        availableFrame: 48_000,
        contextTime: 10,
        advancing: false,
      })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(33_024)
      fake.context.currentTime = 10.2
      now.mockReturnValue(10_200)
      playback(fake, {
        frame: 48_000,
        availableFrame: 64_000,
        contextTime: 10.2,
      })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(42_624)
      now.mockReturnValue(10_312)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(48_000)
      now.mockReturnValue(10_412)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(48_000)
      now.mockReturnValue(10_512)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(48_000)
      now.mockReturnValue(10_532)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(48_960)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('fila vazia e reposta no mesmo instante não altera o cursor de saída', async () => {
    const fake = fakeAudio()
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    Object.assign(fake.context, {
      getOutputTimestamp: () => ({ contextTime: 9.688, performanceTime: 10_000 }),
    })
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10
      playback(fake, { frame: 0, availableFrame: 3072, contextTime: 9 })
      playback(fake, {
        frame: 48_000,
        availableFrame: 48_000,
        contextTime: 10,
        advancing: false,
      })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(33_024)
      playback(fake, { frame: 48_000, availableFrame: 64_000, contextTime: 10 })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(33_024)
      now.mockReturnValue(10_320)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(48_384)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('falha temporária do timestamp não troca a saída atrasada pelo relógio do grafo', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn(() => ({ contextTime: 9.688, performanceTime: 10_000 }))
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10
      playback(fake, { frame: 48_000, availableFrame: 64_000, contextTime: 10 })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(33_024)
      timestamp.mockImplementationOnce(() => {
        throw new Error('Estimativa indisponível')
      })
      fake.context.currentTime = 10 + 512 / 48_000
      now.mockReturnValue(10_000 + 512 / 48)
      playback(fake, {
        frame: 48_512,
        availableFrame: 64_000,
        contextTime: fake.context.currentTime,
      })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(33_536)
      timestamp.mockReturnValueOnce({ contextTime: Number.NaN, performanceTime: 10_020 })
      fake.context.currentTime = 10 + 1024 / 48_000
      now.mockReturnValue(10_000 + 1024 / 48)
      playback(fake, {
        frame: 49_024,
        availableFrame: 64_000,
        contextTime: fake.context.currentTime,
      })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(34_048)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('aguarda timestamp inicial zerado sem antecipar o grafo nem congelar na primeira saída', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn(() => ({ contextTime: 0, performanceTime: 0 }))
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      playback(fake, { frame: 0, availableFrame: 6144, contextTime: 0 })
      expect(output.getPlaybackFrame(1)).toBeNull()
      expect(output.getDiagnostics().playback).toEqual({
        clockMode: 'awaiting-output',
        pcmFrame: null,
        graphPcmFrame: 0,
        graphContextTimeSeconds: 0,
        outputContextTimeSeconds: null,
        outputPerformanceTimeMilliseconds: null,
      })
      fake.context.currentTime = 0.128
      now.mockReturnValue(128)
      playback(fake, { frame: 6144, availableFrame: 12_288, contextTime: 0.128 })
      expect(output.getPlaybackFrame(1)).toBeNull()
      fake.context.currentTime = 0.4
      now.mockReturnValue(400)
      timestamp.mockReturnValue({ contextTime: 0.088, performanceTime: 400 })
      playback(fake, { frame: 19_200, availableFrame: 25_344, contextTime: 0.4 })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(4224)
      now.mockReturnValue(416)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(4992)
      timestamp.mockReturnValue({ contextTime: 0, performanceTime: 0 })
      playback(fake, { frame: 19_712, availableFrame: 25_344, contextTime: 0.4 + 512 / 48_000 })
      now.mockReturnValue(432)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(5760)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('contextTime zero com instante da página válido representa o começo da saída', async () => {
    const fake = fakeAudio()
    Object.assign(fake.context, {
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 312 }),
    })
    const now = vi.spyOn(performance, 'now').mockReturnValue(312)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 0.312
      playback(fake, { frame: 0, availableFrame: 3072, contextTime: 0 })
      playback(fake, { frame: 14_976, availableFrame: 21_120, contextTime: 0.312 })
      expect(output.getPlaybackFrame(1)).toBe(0)
      now.mockReturnValue(328)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(768)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('timestamp sempre zerado libera PCM progressivo no grafo após um segundo', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn(() => ({ contextTime: 0, performanceTime: 0 }))
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const now = vi.spyOn(performance, 'now').mockReturnValue(5000)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10
      playback(fake, { frame: 0, availableFrame: 6144, contextTime: 10 })
      expect(output.getPlaybackFrame(1)).toBeNull()
      for (let quantum = 1; quantum < 375; quantum += 1) {
        fake.context.currentTime = 10 + (quantum * 128) / 48_000
        now.mockReturnValue(5000 + (quantum * 128) / 48)
        playback(fake, {
          frame: quantum * 128,
          availableFrame: quantum * 128 + 6144,
          contextTime: fake.context.currentTime,
        })
        expect(output.getPlaybackFrame(1)).toBeNull()
      }
      fake.context.currentTime = 11
      now.mockReturnValue(6000)
      playback(fake, { frame: 48_000, availableFrame: 54_144, contextTime: 11 })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(48_000)
      expect(output.getDiagnostics().playback.clockMode).toBe('graph')
      timestamp.mockReturnValue({ contextTime: 10.688, performanceTime: 6000 })
      for (let quantum = 376; quantum <= 385; quantum += 1) {
        fake.context.currentTime = 10 + (quantum * 128) / 48_000
        now.mockReturnValue(5000 + (quantum * 128) / 48)
        playback(fake, {
          frame: quantum * 128,
          availableFrame: quantum * 128 + 6144,
          contextTime: fake.context.currentTime,
        })
        expect(output.getPlaybackFrame(1)).toBeCloseTo(quantum * 128)
      }
      expect(output.getDiagnostics().playback.outputContextTimeSeconds).toBeNull()

      await output.pause(2)
      await output.resume(3)
      timestamp.mockReturnValue({ contextTime: 0, performanceTime: 0 })
      fake.context.currentTime = 20
      now.mockReturnValue(7000)
      playback(fake, { epoch: 3, frame: 0, availableFrame: 6144, contextTime: 20 })
      expect(output.getPlaybackFrame(3)).toBeNull()
      fake.context.currentTime = 20.999
      now.mockReturnValue(7999)
      timestamp.mockReturnValue({ contextTime: 20.687, performanceTime: 7999 })
      playback(fake, { epoch: 3, frame: 47_952, availableFrame: 54_096, contextTime: 20.999 })
      expect(output.getPlaybackFrame(3)).toBeCloseTo(32_976)
      expect(output.getDiagnostics().playback.clockMode).toBe('output')
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('prazo também expira no RAF e rejeita primeira correlação que chega tarde', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn(() => ({ contextTime: 0, performanceTime: 0 }))
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10
      playback(fake, { frame: 0, availableFrame: 6144, contextTime: 10 })
      now.mockReturnValue(1099)
      expect(output.getPlaybackFrame(1)).toBeNull()
      now.mockReturnValue(1100)
      fake.context.currentTime = 10.128
      expect(output.getPlaybackFrame(1)).toBeCloseTo(6144)
      expect(output.getDiagnostics().playback.clockMode).toBe('graph')

      await output.pause(2)
      await output.resume(3)
      now.mockReturnValue(2000)
      fake.context.currentTime = 20
      playback(fake, { epoch: 3, frame: 0, availableFrame: 6144, contextTime: 20 })
      now.mockReturnValue(3000)
      fake.context.currentTime = 21
      timestamp.mockReturnValue({ contextTime: 20.688, performanceTime: 3000 })
      playback(fake, { epoch: 3, frame: 48_000, availableFrame: 54_144, contextTime: 21 })
      expect(output.getPlaybackFrame(3)).toBeCloseTo(48_000)
      expect(output.getDiagnostics().playback.clockMode).toBe('graph')
      expect(output.getDiagnostics().playback.outputContextTimeSeconds).toBeNull()
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('não espera indefinidamente se o relógio da página é inválido no startup', async () => {
    const fake = fakeAudio()
    Object.assign(fake.context, {
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    })
    const now = vi.spyOn(performance, 'now').mockReturnValue(Number.NaN)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10.01
      playback(fake)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
      expect(output.getDiagnostics().playback.clockMode).toBe('graph')
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('reset libera espera inicial quando a próxima epoch precisa do fallback do grafo', async () => {
    const fake = fakeAudio()
    Object.assign(fake.context, {
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    })
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    expect(output.getPlaybackFrame(1)).toBeNull()
    await output.pause(2)
    await output.resume(3)
    Object.assign(fake.context, { getOutputTimestamp: undefined })
    fake.context.currentTime = 10
    playback(fake, { epoch: 3 })
    expect(output.getPlaybackFrame(3)).toBe(512)
    await output.dispose()
  })

  it('mantém fallback durante a epoch após desenhar, e tenta saída novamente no reset', async () => {
    const fake = fakeAudio()
    const timestamp = vi.fn((): { contextTime: number; performanceTime: number } => {
      throw new Error('Estimativa inicialmente indisponível')
    })
    Object.assign(fake.context, { getOutputTimestamp: timestamp })
    const now = vi.spyOn(performance, 'now').mockReturnValue(5000)
    const output = new AudioOutput(fake.options)
    try {
      expect(output.getDiagnostics().playback).toEqual({
        clockMode: 'graph',
        pcmFrame: null,
        graphPcmFrame: null,
        graphContextTimeSeconds: null,
        outputContextTimeSeconds: null,
        outputPerformanceTimeMilliseconds: null,
      })
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10.01
      playback(fake)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
      timestamp.mockReturnValue({ contextTime: 9.708, performanceTime: 5010 })
      fake.context.currentTime = 10.02
      now.mockReturnValue(5010)
      playback(fake, { frame: 1024, contextTime: 10 + 512 / 48_000 })
      expect(output.getPlaybackFrame(1)).toBeCloseTo(1472)
      expect(timestamp).toHaveBeenCalledOnce()
      expect(output.getDiagnostics().playback.clockMode).toBe('graph')
      expect(output.getDiagnostics().playback.outputContextTimeSeconds).toBeNull()

      await output.pause(2)
      await output.resume(3)
      expect(output.getDiagnostics().playback.graphPcmFrame).toBeNull()
      expect(output.getDiagnostics().playback.pcmFrame).toBeNull()
      fake.context.currentTime = 12
      now.mockReturnValue(7000)
      timestamp.mockReturnValue({ contextTime: 12, performanceTime: 7000 })
      playback(fake, { epoch: 3, frame: 0, availableFrame: 6144, contextTime: 12 })
      expect(output.getPlaybackFrame(3)).toBe(0)
      expect(output.getDiagnostics().playback.clockMode).toBe('output')
      now.mockReturnValue(7016)
      expect(output.getPlaybackFrame(3)).toBeCloseTo(768)
      await output.pause(4)
      expect(output.getDiagnostics().playback).toEqual({
        clockMode: 'graph',
        pcmFrame: null,
        graphPcmFrame: null,
        graphContextTimeSeconds: null,
        outputContextTimeSeconds: null,
        outputPerformanceTimeMilliseconds: null,
      })
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it.each([Number.NaN, -1])('usa o grafo se performance.now é inválido: %s', async (invalidNow) => {
    const fake = fakeAudio()
    Object.assign(fake.context, {
      getOutputTimestamp: () => ({ contextTime: 9.688, performanceTime: 5000 }),
    })
    const now = vi.spyOn(performance, 'now').mockReturnValue(invalidNow)
    const output = new AudioOutput(fake.options)
    try {
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      fake.context.currentTime = 10.01
      playback(fake)
      expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
    } finally {
      now.mockRestore()
      await output.dispose()
    }
  })

  it('fallback consulta o grafo anterior a uma notificação no fim do quantum', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake, { frame: 0, availableFrame: 4800, contextTime: 1 })
    playback(fake, {
      frame: 4800,
      availableFrame: 4800,
      contextTime: 1.1,
      advancing: false,
    })
    fake.context.currentTime = 1.1 - 128 / 48_000
    expect(output.getPlaybackFrame(1)).toBeCloseTo(4672)
    fake.context.currentTime = 1.1
    expect(output.getPlaybackFrame(1)).toBeCloseTo(4800)
    fake.context.currentTime = 2
    expect(output.getPlaybackFrame(1)).toBeCloseTo(4800)
    await output.dispose()
  })

  it('usa o relógio do AudioContext e limita a extrapolação ao PCM disponível', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    expect(output.getPlaybackFrame(1)).toBeNull()
    await output.prepare()
    output.connect({} as MessagePort, 1)
    expect(output.getPlaybackFrame(1)).toBeNull()
    await output.resume(1)
    expect(output.getPlaybackFrame(1)).toBeNull()
    playback(fake)
    fake.context.currentTime = 10.01
    expect(output.getPlaybackFrame(1)).toBeCloseTo(992)
    fake.context.currentTime = 11
    expect(output.getPlaybackFrame(1)).toBe(4096)
    fake.context.currentTime = 9
    expect(output.getPlaybackFrame(1)).toBe(4096)
    await output.dispose()
  })

  it('não soma latências do dispositivo ou o relógio da página à posição PCM', async () => {
    const fake = fakeAudio()
    Object.assign(fake.context, { baseLatency: 0.5, outputLatency: 0.8 })
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    fake.context.currentTime = 10
    expect(output.getPlaybackFrame(1)).toBe(512)
    expect(output.getDiagnostics()).toMatchObject({
      baseLatencySeconds: 0.5,
      outputLatencySeconds: 0.8,
    })
    await output.dispose()
  })

  it('mantém o cursor congelado durante priming e rebuffer', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake, { frame: 0, availableFrame: 1024, contextTime: 1, advancing: false })
    fake.context.currentTime = 2
    expect(output.getPlaybackFrame(1)).toBe(0)
    playback(fake, { frame: 1024, availableFrame: 1024, contextTime: 2, advancing: false })
    fake.context.currentTime = 3
    expect(output.getPlaybackFrame(1)).toBe(1024)
    playback(fake, { frame: 1024, availableFrame: 5000, contextTime: 3 })
    fake.context.currentTime = 3.01
    expect(output.getPlaybackFrame(1)).toBeCloseTo(1504)
    await output.dispose()
  })

  it('silenciar ou zerar volume preserva o avanço de PCM sem depender dos diagnósticos', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    output.setMuted(true)
    output.setVolume(0)
    fake.context.currentTime = 10.02
    expect(output.getDiagnostics().renderedFrames).toBe(0)
    expect(output.getPlaybackFrame(1)).toBeCloseTo(1472)
    await output.dispose()
  })

  it('ignora outra epoch e invalida o cursor ao pausar, reconectar, retomar ou encerrar', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    expect(output.getPlaybackFrame(2)).toBeNull()
    playback(fake, { epoch: 0, frame: 9999, availableFrame: 10000 })
    fake.context.currentTime = 10
    expect(output.getPlaybackFrame(1)).toBe(512)
    await output.pause(2)
    playback(fake, { epoch: 2 })
    expect(output.getPlaybackFrame(2)).toBeNull()
    await output.resume(3)
    playback(fake)
    expect(output.getPlaybackFrame(3)).toBeNull()
    playback(fake, { epoch: 3 })
    expect(output.getPlaybackFrame(3)).toBe(512)
    output.connect({} as MessagePort, 4)
    expect(output.getPlaybackFrame(4)).toBeNull()
    await output.resume(4)
    playback(fake, { epoch: 4 })
    await output.dispose()
    expect(output.getPlaybackFrame(4)).toBeNull()
  })

  it('resume repetido na mesma epoch não limpa PCM, cursor ou métricas', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    const diagnostics = { ...output.getDiagnostics(), renderedFrames: 512 }
    fake.node.port.onmessage?.({ data: { type: 'stats', diagnostics } } as MessageEvent)
    const posted = fake.node.port.postMessage.mock.calls.length
    const resumed = fake.context.resume.mock.calls.length
    await output.resume(1)
    fake.context.currentTime = 10
    expect(fake.node.port.postMessage).toHaveBeenCalledTimes(posted)
    expect(fake.context.resume).toHaveBeenCalledTimes(resumed)
    expect(output.getDiagnostics().renderedFrames).toBe(512)
    expect(output.getPlaybackFrame(1)).toBe(512)
    await output.resume(2)
    expect(output.getPlaybackFrame(2)).toBeNull()
    expect(output.getDiagnostics().renderedFrames).toBe(0)
    await output.dispose()
  })

  it('resume duplicado enquanto a ativação está pendente envia um único reset', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    let finishResume!: () => void
    fake.context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishResume = resolve
        }),
    )
    const first = output.resume(1)
    const duplicate = output.resume(1)
    expect(
      fake.node.port.postMessage.mock.calls.filter(([message]) => message.type === 'reset'),
    ).toHaveLength(1)
    finishResume()
    await Promise.all([first, duplicate])
    await output.dispose()
  })

  it.each([
    { frame: -1 },
    { frame: 1.5 },
    { availableFrame: 511 },
    { availableFrame: Number.MAX_SAFE_INTEGER },
    { contextTime: Number.NaN },
    { contextTime: -1 },
    { advancing: 'yes' as unknown as boolean },
  ])('ignora cursor inválido sem contaminar a posição válida: %o', async (invalid) => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    playback(fake, invalid)
    fake.context.currentTime = 10
    expect(output.getPlaybackFrame(1)).toBe(512)
    await output.dispose()
  })

  it('recusa regressão de PCM ou relógio dentro da mesma epoch', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    playback(fake, { frame: 511 })
    playback(fake, { availableFrame: 4095 })
    playback(fake, { contextTime: 9 })
    fake.context.currentTime = 10
    expect(output.getPlaybackFrame(1)).toBe(512)
    await output.dispose()
  })

  it('não oferece cursor quando o relógio é inválido ou o contexto está suspenso', async () => {
    const fake = fakeAudio()
    const output = new AudioOutput(fake.options)
    await output.prepare()
    output.connect({} as MessagePort, 1)
    await output.resume(1)
    playback(fake)
    fake.context.currentTime = Number.NaN
    expect(output.getPlaybackFrame(1)).toBeNull()
    fake.context.currentTime = -1
    expect(output.getPlaybackFrame(1)).toBeNull()
    fake.context.currentTime = 10
    fake.context.state = 'suspended'
    expect(output.getPlaybackFrame(1)).toBeNull()
    await output.dispose()
  })

  it.each(['processor', 'context', 'resume'] as const)(
    'erro de %s invalida o cursor',
    async (cause) => {
      const fake = fakeAudio()
      const output = new AudioOutput(fake.options)
      await output.prepare()
      output.connect({} as MessagePort, 1)
      await output.resume(1)
      playback(fake)
      if (cause === 'processor') fake.node.onprocessorerror?.()
      else if (cause === 'context') {
        fake.context.state = 'suspended'
        fake.context.onstatechange?.()
      } else {
        fake.context.resume.mockRejectedValueOnce(new Error('Falha simulada'))
        await expect(output.resume(2)).rejects.toThrow(/ativar/)
      }
      expect(output.getPlaybackFrame(cause === 'resume' ? 2 : 1)).toBeNull()
      await output.dispose()
    },
  )
})
