import { describe, expect, it, vi } from 'vitest'
import { AudioOutput } from '../../src/platform/audio/audio-output'
import type { AudioControlMessage } from '../../src/platform/audio/protocol'

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
