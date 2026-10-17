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
    for (let batch = 0; batch < 10; batch += 1) requestPcm(port, epoch)
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
    expect(
      messages.slice(staleStart).filter((message) => message.type === 'video-frame'),
    ).toHaveLength(0)
    expect(port.postMessage).toHaveBeenCalledTimes(12)
  })
})
