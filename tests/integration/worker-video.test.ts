import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EmulatorCommand,
  EmulatorMessage,
  EmulatorRequest,
} from '../../src/runtime/worker-protocol'
import { buildTestRom } from '../fixtures/rom'

interface TestEndpoint {
  onmessage: ((event: MessageEvent<EmulatorRequest>) => void) | null
}
interface AudioPortProbe {
  onmessage: ((event: MessageEvent<{ type: string; frames: number; epoch: number }>) => void) | null
  start: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
}

let messages: EmulatorMessage[]
let sequence: number
const endpoint = globalThis as unknown as TestEndpoint

function command(value: EmulatorCommand) {
  const id = ++sequence
  endpoint.onmessage!({ data: { id, command: value } } as MessageEvent<EmulatorRequest>)
  const reply = messages.find((message) => message.type === 'reply' && message.id === id)
  if (!reply || reply.type !== 'reply')
    throw new Error('O Worker não respondeu ao comando de teste.')
  return reply
}

function connectAudio(): AudioPortProbe {
  const port: AudioPortProbe = {
    onmessage: null,
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
  }
  const state = command({ type: 'play', playing: true }).snapshot!
  const reply = command({
    type: 'audio-port',
    port: port as unknown as MessagePort,
    sampleRate: 48000,
    epoch: state.audioEpoch + 1,
  })
  expect(reply.error).toBeUndefined()
  expect(reply.snapshot!.audioDriven).toBe(true)
  return port
}

function requestPcm(port: AudioPortProbe, epoch: number): void {
  port.onmessage!({ data: { type: 'need', frames: 6144, epoch } } as MessageEvent<{
    type: string
    frames: number
    epoch: number
  }>)
}

describe('protocolo de vídeo do Worker com transporte determinístico', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    messages = []
    sequence = 0
    vi.resetModules()
    vi.stubGlobal('postMessage', (message: EmulatorMessage) => messages.push(message))
    vi.stubGlobal('onmessage', null)
    await import('../../src/runtime/emulator.worker')
    const initial = command({ type: 'init', rom: buildTestRom({ program: [0xf3, 0x76] }) })
    expect(initial.error).toBeUndefined()
    expect(initial.snapshot!.audioDriven).toBe(false)
  })

  afterEach(() => {
    if (endpoint.onmessage) {
      command({ type: 'play', playing: false })
      command({ type: 'audio-disable' })
    }
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('aloca a conexão após play em trânsito e respeita o piso da saída reutilizada', () => {
    const port = {
      onmessage: null,
      start: vi.fn(),
      close: vi.fn(),
      postMessage: vi.fn(),
    } as unknown as AudioPortProbe
    const initial = command({ type: 'inspect' }).snapshot!
    const staleFloor = initial.audioEpoch + 1
    const playing = command({ type: 'play', playing: true }).snapshot!
    const connected = command({
      type: 'audio-port',
      port: port as unknown as MessagePort,
      sampleRate: 48_000,
      epoch: staleFloor,
    })
    expect(connected.error).toBeUndefined()
    expect(connected.snapshot!.audioEpoch).toBeGreaterThan(playing.audioEpoch)
    requestPcm(port, playing.audioEpoch)
    expect(port.postMessage).not.toHaveBeenCalled()
    requestPcm(port, connected.snapshot!.audioEpoch)
    expect(port.postMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(port.postMessage).toHaveBeenCalledOnce()

    const reusedFloor = connected.snapshot!.audioEpoch + 100
    const reused = command({
      type: 'audio-port',
      port: port as unknown as MessagePort,
      sampleRate: 48_000,
      epoch: reusedFloor,
    })
    expect(reused.error).toBeUndefined()
    expect(reused.snapshot!.audioEpoch).toBe(reusedFloor)
    expect(command({ type: 'play', playing: true }).snapshot!.audioEpoch).toBe(reusedFloor)
  })

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejeita piso inválido %s sem alterar a geração ou conectar o port',
    (floor) => {
      const initial = command({ type: 'inspect' }).snapshot!
      const port = { start: vi.fn(), close: vi.fn() }
      const reply = command({
        type: 'audio-port',
        port: port as unknown as MessagePort,
        sampleRate: 48_000,
        epoch: floor,
      })
      expect(reply.error).toContain('Geração de áudio')
      expect(command({ type: 'inspect' }).snapshot!.audioEpoch).toBe(initial.audioEpoch)
      expect(port.start).not.toHaveBeenCalled()
      expect(port.close).not.toHaveBeenCalled()
    },
  )

  it('mantém a posição PCM no resume duplicado e reinicia em transições reais de época', () => {
    const port = connectAudio()
    const epoch = command({ type: 'inspect' }).snapshot!.audioEpoch
    requestPcm(port, epoch)
    vi.advanceTimersByTime(128)
    const first = messages
      .filter((message) => message.type === 'video-frame')
      .map((message) => message.frame)
    expect(first.length).toBeGreaterThan(5)
    expect(first[0]!.pcmFrame).toBe(751)
    const duplicate = command({ type: 'play', playing: true })
    expect(duplicate.snapshot!.audioEpoch).toBe(epoch)
    const firstEnd = first.at(-1)!.pcmFrame
    const nextStart = messages.length
    requestPcm(port, epoch)
    vi.advanceTimersByTime(128)
    const next = messages
      .slice(nextStart)
      .filter((message) => message.type === 'video-frame')
      .map((message) => message.frame)
    expect(next[0]!.pcmFrame).toBeGreaterThan(firstEnd)
    expect(next[0]!.pcmFrame).toBeGreaterThan(6144)
    const paused = command({ type: 'play', playing: false }).snapshot!
    expect(paused.audioEpoch).toBeGreaterThan(epoch)
    expect(command({ type: 'play', playing: false }).snapshot!.audioEpoch).toBe(paused.audioEpoch)
    const ignored = port.postMessage.mock.calls.length
    requestPcm(port, epoch)
    requestPcm(port, paused.audioEpoch)
    expect(port.postMessage).toHaveBeenCalledTimes(ignored)
    const resumed = command({ type: 'play', playing: true }).snapshot!
    expect(resumed.audioEpoch).toBeGreaterThan(paused.audioEpoch)
    const resumedStart = messages.length
    requestPcm(port, resumed.audioEpoch)
    vi.advanceTimersByTime(128)
    const resumedFrames = messages
      .slice(resumedStart)
      .filter((message) => message.type === 'video-frame')
      .map((message) => message.frame)
    expect(resumedFrames.length).toBeGreaterThan(5)
    expect(resumedFrames[0]!.pcmFrame).toBeLessThan(804)
    expect(resumedFrames.every((frame) => frame.epoch === resumed.audioEpoch)).toBe(true)
    expect(messages.filter((message) => message.type === 'error')).toHaveLength(0)
  })

  it('limita empréstimos em trânsito e aceita devolução de época anterior sem snapshot adicional', () => {
    const port = connectAudio()
    const epoch = command({ type: 'inspect' }).snapshot!.audioEpoch
    for (let batch = 0; batch < 10; batch += 1) {
      requestPcm(port, epoch)
      vi.advanceTimersByTime(128)
    }
    const leased = messages
      .filter((message) => message.type === 'video-frame')
      .map((message) => message.frame)
    expect(leased).toHaveLength(64)
    expect(new Set(leased.map((frame) => frame.slot)).size).toBe(64)
    expect(port.postMessage).toHaveBeenCalledTimes(10)
    command({ type: 'play', playing: false })
    const resumed = command({ type: 'play', playing: true }).snapshot!
    const first = leased[0]!
    const returned = command({
      type: 'recycle-video',
      slot: first.slot,
      token: first.token,
      buffer: first.framebuffer.buffer as ArrayBuffer,
    })
    expect(returned.snapshot).toBeUndefined()
    expect(returned.error).toBeUndefined()
    const newStart = messages.length
    requestPcm(port, resumed.audioEpoch)
    vi.advanceTimersByTime(128)
    const replacement = messages
      .slice(newStart)
      .filter((message) => message.type === 'video-frame')
      .map((message) => message.frame)
    expect(replacement).toHaveLength(1)
    expect(replacement[0]!.slot).toBe(first.slot)
    expect(replacement[0]!.token).not.toBe(first.token)
    command({
      type: 'recycle-video',
      slot: first.slot,
      token: first.token,
      buffer: new ArrayBuffer(23040),
    })
    const staleStart = messages.length
    requestPcm(port, resumed.audioEpoch)
    vi.advanceTimersByTime(128)
    expect(
      messages.slice(staleStart).filter((message) => message.type === 'video-frame'),
    ).toHaveLength(0)
    expect(port.postMessage).toHaveBeenCalledTimes(12)
  })

  it('avança no tempo real mesmo sem demanda PCM e não antecipa a CPU ao pedir áudio', () => {
    const port = connectAudio()
    const initial = command({ type: 'inspect' }).snapshot!
    vi.advanceTimersByTime(128)
    const elapsed = command({ type: 'inspect' }).snapshot!
    expect(elapsed.cpu.totalTCycles - initial.cpu.totalTCycles).toBeGreaterThan(500_000)
    expect(elapsed.cpu.totalTCycles - initial.cpu.totalTCycles).toBeLessThan(540_000)
    expect(elapsed.audioProducer!.producedFrames).toBeGreaterThan(6000)
    expect(port.postMessage).not.toHaveBeenCalled()
    requestPcm(port, elapsed.audioEpoch)
    const afterDemand = command({ type: 'inspect' }).snapshot!
    expect(afterDemand.cpu.totalTCycles).toBe(elapsed.cpu.totalTCycles)
    expect(afterDemand.frameId).toBe(elapsed.frameId)
    expect(port.postMessage).toHaveBeenCalledOnce()
    expect(afterDemand.audioProducer!.sentFrames).toBeGreaterThan(0)
    expect(afterDemand.audioProducer!.droppedFrames).toBe(0)
  })

  it('entrega PCM parcial e aceita entrada enquanto um pedido vazio aguarda o próximo tick', () => {
    const port = connectAudio()
    const initial = command({ type: 'inspect' }).snapshot!
    requestPcm(port, initial.audioEpoch)
    requestPcm(port, initial.audioEpoch)
    const pressed = command({ type: 'input', button: 'a', pressed: true })
    expect(pressed.error).toBeUndefined()
    expect(pressed.snapshot!.cpu.totalTCycles).toBe(initial.cpu.totalTCycles)
    expect(pressed.snapshot!.audioProducer!.pendingFrames).toBe(6144)
    expect(port.postMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(port.postMessage).toHaveBeenCalledOnce()
    const samples = port.postMessage.mock.calls[0]![0].samples as Float32Array
    expect(samples.length / 2).toBeGreaterThan(380)
    expect(samples.length / 2).toBeLessThan(400)
    expect(command({ type: 'inspect' }).snapshot!.audioProducer!.pendingFrames).toBe(0)
  })

  it('limpa o pedido pendente na pausa e contabiliza retenção e descarte no produtor limitado', () => {
    const port = connectAudio()
    const initial = command({ type: 'inspect' }).snapshot!
    requestPcm(port, initial.audioEpoch)
    const paused = command({ type: 'play', playing: false }).snapshot!
    expect(paused.audioProducer!.pendingFrames).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(port.postMessage).not.toHaveBeenCalled()
    const resumed = command({ type: 'play', playing: true }).snapshot!
    vi.advanceTimersByTime(1000)
    const withheld = command({ type: 'inspect' }).snapshot!
    expect(withheld.audioProducer!.queuedFrames).toBe(32768)
    expect(withheld.audioProducer!.droppedFrames).toBeGreaterThan(0)
    expect(withheld.audioProducer!.producedFrames).toBe(
      withheld.audioProducer!.queuedFrames + withheld.audioProducer!.droppedFrames,
    )
    expect(port.postMessage).not.toHaveBeenCalled()
    requestPcm(port, initial.audioEpoch)
    expect(port.postMessage).not.toHaveBeenCalled()
    requestPcm(port, resumed.audioEpoch)
    expect(port.postMessage).toHaveBeenCalledOnce()
    command({ type: 'audio-disable' })
    vi.advanceTimersByTime(32)
    const detached = command({ type: 'inspect' }).snapshot!
    expect(detached.audioProducer).toBeNull()
    expect(detached.cpu.totalTCycles).toBeGreaterThan(withheld.cpu.totalTCycles)
  })
})
