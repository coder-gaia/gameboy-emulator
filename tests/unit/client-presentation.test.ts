import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmulatorClient } from '../../src/runtime/emulator-client'
import type { AudioOutput } from '../../src/platform/audio'
import type {
  EmulatorMessage,
  EmulatorRequest,
  EmulatorSnapshot,
  EmulatorVideoFrame,
} from '../../src/runtime/worker-protocol'
import { GameBoy } from '../../src/core/gameboy'
import { buildTestRom } from '../fixtures/rom'

const rom = buildTestRom()

class ControlledWorker {
  static latest: ControlledWorker
  onmessage: ((event: MessageEvent<EmulatorMessage>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  readonly recycled: { slot: number; token: number; buffer: ArrayBuffer }[] = []
  readonly ports: MessagePort[] = []
  readonly state: EmulatorSnapshot

  constructor() {
    ControlledWorker.latest = this
    const machine = new GameBoy(rom)
    this.state = {
      framebuffer: new Uint8Array(160 * 144),
      frameId: 0,
      cpu: machine.cpu.snapshot(),
      nextBytes: [],
      serial: '',
      batteryRevision: 0,
      playing: false,
      audioEpoch: 1,
      audioDriven: false,
      romId: machine.romId,
      rewind: {
        enabled: false,
        active: false,
        entries: 0,
        availableSeconds: 0,
        allocatedBytes: 0,
        usedBytes: 0,
        maxSeconds: 20,
        maxBytes: 8 * 1024 * 1024,
      },
    }
  }

  postMessage({ id, command }: EmulatorRequest): void {
    if (command.type === 'recycle-video') {
      this.recycled.push({
        slot: command.slot,
        token: command.token,
        buffer: structuredClone(command.buffer, { transfer: [command.buffer] }),
      })
      return
    }
    if (command.type === 'play' && this.state.playing !== command.playing) {
      this.state.playing = command.playing
      this.state.audioEpoch += 1
    }
    if (command.type === 'audio-port') {
      this.ports.push(command.port)
      this.state.audioDriven = true
      this.state.audioEpoch = Math.max(this.state.audioEpoch + 1, command.epoch)
    }
    if (command.type === 'audio-disable') {
      this.state.audioDriven = false
      this.state.audioEpoch += 1
    }
    this.emit({ type: 'reply', id, snapshot: this.snapshot() })
  }

  snapshot(): EmulatorSnapshot {
    return { ...this.state, framebuffer: this.state.framebuffer.slice() }
  }

  publish(): void {
    this.emit({ type: 'frame', snapshot: this.snapshot() })
  }

  emit(message: EmulatorMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<EmulatorMessage>)
  }

  terminate(): void {
    this.terminated = true
    this.ports.forEach((port) => port.close())
  }
}

describe('cliente de apresentação entre mensagens e gerações', () => {
  let client: EmulatorClient
  let worker: ControlledWorker
  let playback: number | null
  let playbackEpoch: number | null
  let outputEpoch: number
  let outputActive: boolean
  let output: AudioOutput
  const connectedPorts: MessagePort[] = []

  beforeEach(async () => {
    vi.stubGlobal('Worker', ControlledWorker)
    client = await EmulatorClient.create(rom)
    worker = ControlledWorker.latest
    playback = null
    playbackEpoch = null
    outputEpoch = 0
    outputActive = false
    output = {
      prepare: async () => 48_000,
      connect: (port: MessagePort, epoch: number) => {
        connectedPorts.push(port)
        outputEpoch = epoch
        outputActive = false
        playback = null
        playbackEpoch = null
      },
      resume: async (epoch: number) => {
        outputEpoch = epoch
        outputActive = true
      },
      pause: async (epoch: number) => {
        outputEpoch = epoch
        outputActive = false
        playback = null
        playbackEpoch = null
      },
      getDiagnostics: () => ({ epoch: outputEpoch }),
      getPlaybackFrame: (epoch: number) =>
        outputActive && epoch === outputEpoch && epoch === playbackEpoch ? playback : null,
    } as unknown as AudioOutput
  })

  afterEach(() => {
    client.dispose()
    connectedPorts.splice(0).forEach((port) => port.close())
    vi.unstubAllGlobals()
  })

  async function audio(): Promise<void> {
    await client.resume()
    await client.attachAudio(output)
  }

  function setPlayback(frame: number, epoch = client.inspection.audioEpoch): void {
    playback = frame
    playbackEpoch = epoch
  }

  function video(token: number, pcmFrame: number, epoch = client.inspection.audioEpoch) {
    const image: EmulatorVideoFrame = {
      epoch,
      slot: token % 32,
      token,
      frameId: token,
      pcmFrame,
      framebuffer: new Uint8Array(160 * 144).fill(token % 4),
    }
    worker.emit({ type: 'video-frame', frame: image })
    return image
  }

  it('mostra cada quadro ao chegar, antes do RAF ou do primeiro cursor audível', async () => {
    await audio()
    video(1, 800)
    expect(client.frameId).toBe(1)
    video(2, 1600)
    expect(client.frameId).toBe(2)
    worker.state.frameId = 3
    worker.state.framebuffer.fill(3)
    worker.publish()
    expect(client.inspection.frameId).toBe(3)
    expect(client.frameId).toBe(2)
    const revision = client.presentationRevision
    client.presentAudioFrame()
    expect(client.frameId).toBe(2)
    expect(client.presentationRevision).toBe(revision)
    expect(client.framebuffer[0]).toBe(2)
    expect(client.getPresentationDiagnostics().pcmCursorFrame).toBeNull()
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2])
    video(4, 2400)
    expect(client.frameId).toBe(4)
    setPlayback(799)
    client.presentAudioFrame()
    expect(client.frameId).toBe(4)
    expect(client.getPresentationDiagnostics().pcmCursorFrame).toBe(799)
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2, 4])
  })

  it('cursor parado em priming continua apenas diagnóstico enquanto a máquina responde', async () => {
    await audio()
    setPlayback(0)
    for (let id = 1; id <= 5; id += 1) {
      video(id, id * 800)
      expect(client.frameId).toBe(id)
      client.presentAudioFrame()
      expect(client.frameId).toBe(id)
      expect(client.getPresentationDiagnostics().pcmCursorFrame).toBe(0)
    }
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2, 3, 4, 5])
  })

  it('copia a imagem apresentada antes de devolver e destacar o buffer emprestado', async () => {
    await audio()
    const image = video(1, 800)
    expect(image.framebuffer.byteLength).toBe(0)
    expect(client.framebuffer[0]).toBe(1)
    setPlayback(800)
    client.presentAudioFrame()
    expect(image.framebuffer.byteLength).toBe(0)
    expect(client.framebuffer.byteLength).toBe(160 * 144)
    expect(client.framebuffer[0]).toBe(1)
    new Uint8Array(worker.recycled[0]!.buffer).fill(3)
    expect(client.framebuffer[0]).toBe(1)
  })

  it('apresentação imediata continua rejeitando posição antiga e geração incorreta', async () => {
    await audio()
    video(1, 1600)
    const revision = client.presentationRevision
    const late = video(2, 800)
    const oldEpoch = video(3, 2400, client.inspection.audioEpoch - 1)
    expect(late.framebuffer.byteLength).toBe(0)
    expect(oldEpoch.framebuffer.byteLength).toBe(0)
    expect(client.frameId).toBe(1)
    expect(client.presentationRevision).toBe(revision)
    client.presentAudioFrame()
    expect(client.frameId).toBe(1)
    expect(client.presentationRevision).toBe(revision)
    video(4, 2400)
    expect(client.frameId).toBe(4)
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2, 3, 4])
  })

  it('a pausa mostra o estado atual e impede que imagens atrasadas reapareçam', async () => {
    await audio()
    const oldEpoch = client.inspection.audioEpoch
    video(1, 800)
    worker.state.frameId = 9
    worker.state.framebuffer.fill(3)
    await client.pause()
    expect(client.frameId).toBe(9)
    expect(client.framebuffer[0]).toBe(3)
    const delayed = video(2, 1600, oldEpoch)
    expect(delayed.framebuffer.byteLength).toBe(0)
    await client.resume()
    setPlayback(10_000)
    client.presentAudioFrame()
    expect(client.frameId).toBe(9)
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2])
  })

  it('uma nova conexão invalida os quadros da conexão anterior', async () => {
    await audio()
    const oldEpoch = client.inspection.audioEpoch
    video(1, 800)
    await client.disableAudio()
    await audio()
    video(2, 900, oldEpoch)
    video(3, 700)
    setPlayback(10_000, oldEpoch)
    client.presentAudioFrame()
    expect(client.frameId).toBe(3)
    expect(client.getPresentationDiagnostics().pcmCursorFrame).toBeNull()
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2, 3])
    setPlayback(800)
    client.presentAudioFrame()
    expect(client.frameId).toBe(3)
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2, 3])
  })

  it('rewind mostra o estado atual e rejeita vídeo até retomar uma geração nova', async () => {
    await audio()
    video(1, 800)
    worker.state.rewind.active = true
    worker.state.frameId = 9
    worker.state.framebuffer.fill(3)
    worker.publish()
    const delayed = video(2, 1600)
    client.presentAudioFrame()
    expect(client.frameId).toBe(9)
    expect(client.framebuffer[0]).toBe(3)
    expect(delayed.framebuffer.byteLength).toBe(0)
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2])

    worker.state.rewind.active = false
    worker.state.audioEpoch += 1
    worker.publish()
    video(3, 100)
    client.presentAudioFrame()
    expect(client.frameId).toBe(3)
    expect(client.getPresentationDiagnostics().pcmCursorFrame).toBeNull()
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2, 3])
  })

  it('reutiliza a saída entre Workers sem repetir a epoch nem aceitar cursor do cartucho anterior', async () => {
    await audio()
    const previousEpoch = client.inspection.audioEpoch
    setPlayback(10_000)
    client.dispose()

    client = await EmulatorClient.create(rom)
    worker = ControlledWorker.latest
    expect(client.inspection.audioEpoch).toBeLessThan(previousEpoch)
    await audio()
    const currentEpoch = client.inspection.audioEpoch
    expect(currentEpoch).toBeGreaterThan(previousEpoch)

    const pending = video(1, 800)
    expect(client.frameId).toBe(1)
    expect(pending.framebuffer.byteLength).toBe(0)
    setPlayback(10_000, previousEpoch)
    client.presentAudioFrame()
    expect(client.frameId).toBe(1)
    expect(client.getPresentationDiagnostics().pcmCursorFrame).toBeNull()
    expect(pending.framebuffer.byteLength).toBe(0)
    expect(worker.recycled.map((image) => image.token)).toEqual([1])

    setPlayback(800, currentEpoch)
    client.presentAudioFrame()
    expect(client.frameId).toBe(1)
    expect(pending.framebuffer.byteLength).toBe(0)
    expect(worker.recycled.map((image) => image.token)).toEqual([1])
  })

  it('conecta o Output com a geração efetivamente alocada pelo Worker', async () => {
    await client.resume()
    // Representa um play processado antes da resposta alcançar o cliente.
    worker.state.audioEpoch = 30
    await client.attachAudio(output)
    expect(client.inspection.audioEpoch).toBe(31)
    expect(outputEpoch).toBe(31)
    expect(outputActive).toBe(true)
    video(1, 800)
    setPlayback(800, 31)
    client.presentAudioFrame()
    expect(client.frameId).toBe(1)
  })

  it('LCD apagado muda a apresentação mesmo sem mudar o frameId', () => {
    worker.state.framebuffer.fill(2)
    worker.publish()
    const revision = client.presentationRevision
    worker.state.framebuffer.fill(0)
    worker.publish()
    expect(client.frameId).toBe(0)
    expect(client.presentationRevision).toBeGreaterThan(revision)
    expect(client.framebuffer[0]).toBe(0)
  })

  it('LCD apagado em dois quadros de áudio muda a apresentação preservando o frameId', async () => {
    await audio()
    const first = video(1, 800)
    setPlayback(800)
    client.presentAudioFrame()
    const revision = client.presentationRevision
    const blank: EmulatorVideoFrame = {
      epoch: client.inspection.audioEpoch,
      slot: 2,
      token: 2,
      frameId: first.frameId,
      pcmFrame: 1600,
      framebuffer: new Uint8Array(160 * 144),
    }
    worker.emit({ type: 'video-frame', frame: blank })
    expect(client.framebuffer[0]).toBe(0)
    expect(client.presentationRevision).toBeGreaterThan(revision)
    setPlayback(1599)
    client.presentAudioFrame()
    expect(client.frameId).toBe(first.frameId)
    expect(client.presentationRevision).toBeGreaterThan(revision)
    expect(client.framebuffer[0]).toBe(0)
    expect(blank.framebuffer.byteLength).toBe(0)
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2])
  })

  it('notifica desenhos reais imediatamente sem contar outra vez no RAF ou no descarte', async () => {
    await audio()
    const received: number[] = []
    const unsubscribe = client.subscribe(() => {
      received.push(client.frameId)
      client.noteFrameDrawn(client.presentationRevision)
    })
    video(1, 800)
    video(2, 1600)
    expect(client.drawnFrames).toBe(2)
    expect(received).toEqual([1, 2])
    setPlayback(800)
    client.presentAudioFrame()
    const revision = client.presentationRevision
    client.noteFrameDrawn(revision)
    client.noteFrameDrawn(revision)
    expect(client.drawnFrames).toBe(2)
    expect(received).toEqual([1, 2])
    video(3, 2400)
    expect(client.drawnFrames).toBe(3)
    client.dispose()
    video(4, 3200)
    client.presentAudioFrame()
    expect(client.frameId).toBe(3)
    expect(client.drawnFrames).toBe(3)
    expect(worker.terminated).toBe(true)
    expect(worker.recycled.map((image) => image.token)).toEqual([1, 2, 3])
    unsubscribe()
  })

  it('registra intervalos reais de desenho e limpa a cadência ao mudar de geração', async () => {
    const now = vi.spyOn(performance, 'now')
    try {
      await audio()
      video(1, 800)
      setPlayback(800)
      client.presentAudioFrame()
      now.mockReturnValue(1000)
      client.noteFrameDrawn(client.presentationRevision)
      now.mockReturnValue(1100)
      client.noteFrameDrawn(client.presentationRevision)
      video(2, 1600)
      setPlayback(1600)
      client.presentAudioFrame()
      now.mockReturnValue(1130)
      client.noteFrameDrawn(client.presentationRevision)
      expect(client.getPresentationDiagnostics()).toEqual({
        receivedVideoFrames: 2,
        queuedVideoFrames: 0,
        pcmCursorFrame: 1600,
        lastDrawGapMilliseconds: 130,
        maximumDrawGapMilliseconds: 130,
        drawGapsOver100Milliseconds: 1,
      })
      await client.pause()
      now.mockReturnValue(10_000)
      await client.resume()
      video(3, 800)
      setPlayback(800)
      client.presentAudioFrame()
      client.noteFrameDrawn(client.presentationRevision)
      expect(client.getPresentationDiagnostics()).toMatchObject({
        maximumDrawGapMilliseconds: 0,
        drawGapsOver100Milliseconds: 0,
        lastDrawGapMilliseconds: null,
        pcmCursorFrame: 800,
      })
    } finally {
      now.mockRestore()
    }
  })
})
