import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { armInputLatency, observeInputLatency, readInputLatency } from '../helpers/input-latency'
import type { EmulatorMessage } from '../../src/runtime/worker-protocol'

class WorkerStub {
  private readonly listeners: ((event: { data: EmulatorMessage }) => void)[] = []

  addEventListener(_type: string, listener: (event: { data: EmulatorMessage }) => void): void {
    this.listeners.push(listener)
  }

  postMessage(message: unknown): void {
    void message
  }

  emit(data: EmulatorMessage): void {
    for (const listener of this.listeners) listener({ data })
  }
}

class CanvasStub {
  readonly canvas = { getAttribute: () => 'Tela do emulador' }

  putImageData(image: ImageData, dx: number, dy: number): void {
    void image
    void dx
    void dy
  }
}

const nativeWorkerPost = WorkerStub.prototype.postMessage
const nativeCanvasDraw = CanvasStub.prototype.putImageData

function pixels(value: number): Uint8Array {
  return new Uint8Array(160 * 144).fill(value)
}

function image(pixels: Uint8Array): ImageData {
  const rgba = new Uint8ClampedArray(160 * 144 * 4)
  for (let index = 0; index < pixels.length; index += 1) {
    rgba.fill(pixels[index]! * 64, index * 4, index * 4 + 3)
    rgba[index * 4 + 3] = 255
  }
  return { width: 160, height: 144, data: rgba } as ImageData
}

async function setup() {
  let now = 0
  const events = new Map<string, (event: unknown) => void>()
  const windowStub = { Worker: WorkerStub, AudioWorkletNode: class {} }
  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('Worker', WorkerStub)
  vi.stubGlobal('CanvasRenderingContext2D', CanvasStub)
  vi.stubGlobal('document', {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      events.set(type, listener),
  })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const page = {
    async addInitScript(script: () => void) {
      script()
    },
    async evaluate(script: (argument: unknown) => unknown, argument?: unknown) {
      return script(argument)
    },
  } as unknown as Page
  await observeInputLatency(page)
  const worker = new windowStub.Worker()
  const canvas = new CanvasStub()
  let frameId = 0

  function present(pixels: Uint8Array, at: number): void {
    now = at
    worker.emit({
      type: 'frame',
      snapshot: { framebuffer: pixels, frameId: ++frameId, audioDriven: false },
    } as unknown as EmulatorMessage)
    now = at + 1
    canvas.putImageData(image(pixels), 0, 0)
  }

  return {
    page,
    worker,
    present,
    async press(at: number): Promise<void> {
      await armInputLatency(page)
      now = at
      events.get('pointerdown')?.({
        target: { closest: () => ({ getAttribute: () => 'Botão A' }) },
        pointerType: 'touch',
        isTrusted: true,
      })
      now = at + 1
      worker.postMessage({ id: 0, command: { type: 'input', button: 'a', pressed: true } })
    },
    release(at: number): void {
      now = at
      worker.postMessage({ id: 0, command: { type: 'input', button: 'a', pressed: false } })
    },
  }
}

afterEach(() => {
  WorkerStub.prototype.postMessage = nativeWorkerPost
  CanvasStub.prototype.putImageData = nativeCanvasDraw
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('observação de latência até o primeiro pixel e estabilização posterior', () => {
  it('preserva a primeira mudança parcial e estabiliza pelo hash completo posterior', async () => {
    const fixture = await setup()
    const baseline = pixels(1)
    fixture.present(baseline, 1)
    await fixture.press(10)
    const partial = baseline.slice()
    partial[73 * 160 + 78] = 2
    fixture.present(partial, 20)
    const first = (await readInputLatency(fixture.page)).trials[0]!
    expect(first.capturedAt).toBe(20)
    expect(first.drawnAt).toBe(21)
    fixture.release(30)
    for (const at of [40, 57, 74]) fixture.present(pixels(3), at)
    const settled = (await readInputLatency(fixture.page)).trials[0]!
    expect(settled.capturedAt).toBe(20)
    expect(settled.drawnAt).toBe(21)
    expect(settled.coreHash).toBe(first.coreHash)
    expect(settled.canvasHash).toBe(first.canvasHash)
    expect(settled.settledCanvasHash).not.toBe(first.canvasHash)
    expect(settled.settledDraws).toBe(3)
    expect(settled.totalMs).toBe(11)
    await expect(armInputLatency(fixture.page)).resolves.toBeUndefined()
  })

  it('não estabiliza se a região retorna à imagem anterior à entrada', async () => {
    const fixture = await setup()
    const baseline = pixels(1)
    fixture.present(baseline, 1)
    await fixture.press(10)
    fixture.present(pixels(2), 20)
    fixture.release(30)
    for (const at of [40, 57, 74]) fixture.present(baseline, at)
    const trial = (await readInputLatency(fixture.page)).trials[0]!
    expect(trial.totalMs).toBe(11)
    expect(trial.settledDraws).toBe(0)
    expect(trial.settledCanvasHash).toBeNull()
    await expect(armInputLatency(fixture.page)).rejects.toThrow(/estável/)
  })

  it('reinicia a contagem quando a imagem posterior ainda muda entre desenhos', async () => {
    const fixture = await setup()
    fixture.present(pixels(1), 1)
    await fixture.press(10)
    fixture.present(pixels(2), 20)
    fixture.release(30)
    fixture.present(pixels(2), 40)
    fixture.present(pixels(2), 57)
    expect((await readInputLatency(fixture.page)).trials[0]!.settledDraws).toBe(2)
    fixture.present(pixels(3), 74)
    const trial = (await readInputLatency(fixture.page)).trials[0]!
    expect(trial.settledDraws).toBe(1)
    expect(trial.drawnAt).toBe(21)
    await expect(armInputLatency(fixture.page)).rejects.toThrow(/estável/)
  })
})
