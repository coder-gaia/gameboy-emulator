import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { AudioStreamDiagnostics } from '../../src/platform/audio/protocol'
import type {
  EmulatorMessage,
  EmulatorSnapshot,
  MachineCheckpoint,
} from '../../src/runtime/worker-protocol'

interface StateAudioProbe {
  contexts: AudioContext[]
  nodes: AudioWorkletNode[]
  stats: AudioStreamDiagnostics[]
  controls: { type: string; epoch: number | undefined; active: boolean | undefined }[]
  worker: Worker | null
  snapshot: EmulatorSnapshot | null
  checkpoint: MachineCheckpoint | null
}

type ProbeWindow = Window & typeof globalThis & { __stateAudioProbe: StateAudioProbe }

async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: StateAudioProbe = {
      contexts: [],
      nodes: [],
      stats: [],
      controls: [],
      worker: null,
      snapshot: null,
      checkpoint: null,
    }
    ;(window as ProbeWindow).__stateAudioProbe = probe
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options)
        probe.contexts.push(this)
      }
    }
    const NativeNode = window.AudioWorkletNode
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options)
        probe.nodes.push(this)
        this.port.addEventListener('message', ({ data }) => {
          if (data?.type === 'stats') probe.stats.push(data.diagnostics as AudioStreamDiagnostics)
        })
        this.port.start()
        const send = this.port.postMessage
        this.port.postMessage = function (
          this: MessagePort,
          message: unknown,
          options?: Transferable[] | StructuredSerializeOptions,
        ): void {
          const value = message as { type: string; epoch?: number; active?: boolean }
          probe.controls.push({ type: value.type, epoch: value.epoch, active: value.active })
          Reflect.apply(send, this, [message, options])
        }
      }
    }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        probe.worker = this
        this.addEventListener('message', ({ data }: MessageEvent<EmulatorMessage>) => {
          if ('snapshot' in data && data.snapshot) probe.snapshot = data.snapshot
          if (data.type === 'reply' && data.checkpoint) probe.checkpoint = data.checkpoint
        })
      }
    }
  })
}

async function readProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).__stateAudioProbe
    return {
      contextState: probe.contexts.at(-1)?.state,
      sampleRate: probe.contexts.at(-1)?.sampleRate,
      contexts: probe.contexts.length,
      nodes: probe.nodes.length,
      latest: probe.stats.at(-1),
      control: probe.controls.at(-1),
      playing: probe.snapshot?.playing,
      cycles: probe.snapshot?.cpu.totalTCycles,
      frame: probe.snapshot?.frameId,
      epoch: probe.snapshot?.audioEpoch,
      savedCycles: probe.checkpoint?.core.cpu.totalTCycles,
      savedFrame: probe.checkpoint?.core.bus.ppu.frameId,
    }
  })
}

async function openTobuWithAudio(page: Page): Promise<void> {
  await instrument(page)
  await page.goto('/')
  await page.getByRole('button', { name: /^Jogar 01 Tobu Tobu Girl\./ }).click()
  await expect.poll(async () => (await readProbe(page)).frame ?? 0).toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Silenciar', exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await readProbe(page)).latest?.energy ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0)
}

test('estado com som ativo volta em pausa, limpa PCM antigo e retoma na nova geração', async ({
  page,
}) => {
  await openTobuWithAudio(page)
  await page.getByRole('button', { name: 'Salvar estado', exact: true }).click()
  const status = page.getByRole('status', { name: 'Estado dos slots', exact: true })
  await expect(status).toContainText('Estado salvo no slot 1')
  await expect.poll(async () => (await readProbe(page)).contextState).toBe('suspended')
  const saved = await readProbe(page)
  expect(saved.savedCycles).toBeDefined()
  expect(saved.savedFrame).toBeGreaterThan(3)
  expect(saved.playing).toBe(false)

  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect
    .poll(async () => (await readProbe(page)).frame ?? 0)
    .toBeGreaterThan(saved.savedFrame! + 5)
  await expect.poll(async () => (await readProbe(page)).latest?.energy ?? 0).toBeGreaterThan(0)
  const beforeLoad = await readProbe(page)
  await page.getByRole('button', { name: 'Carregar estado', exact: true }).click()
  await expect(status).toContainText('Slot 1 carregado')
  await expect.poll(async () => (await readProbe(page)).contextState).toBe('suspended')
  const restored = await readProbe(page)
  expect(restored.playing).toBe(false)
  expect(restored.cycles).toBe(saved.savedCycles)
  expect(restored.frame).toBe(saved.savedFrame)
  expect(restored.epoch).toBeGreaterThan(beforeLoad.epoch!)
  expect(restored.control).toEqual({ type: 'reset', epoch: restored.epoch, active: false })
  await expect.poll(async () => (await readProbe(page)).latest?.queuedFrames).toBe(0)
  await page.waitForTimeout(150)
  expect((await readProbe(page)).cycles).toBe(saved.savedCycles)

  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect.poll(async () => (await readProbe(page)).contextState).toBe('running')
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      const latest = probe.latest
      return latest && latest.epoch === probe.epoch && latest.epoch > restored.epoch!
        ? latest.renderedFrames
        : 0
    })
    .toBeGreaterThan(8192)
  const resumed = await readProbe(page)
  expect(resumed.epoch).toBeGreaterThan(restored.epoch!)
  expect(resumed.latest!.energy).toBeGreaterThan(0)
  expect(resumed.latest!.queuedFrames).toBeLessThanOrEqual(16_384)
  expect(resumed.frame).toBeGreaterThan(saved.savedFrame!)
  expect(resumed.contexts).toBe(1)
  expect(resumed.nodes).toBe(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('Worker adapta estado de outra taxa de áudio ao contexto conectado', async ({ page }) => {
  await openTobuWithAudio(page)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(async () => (await readProbe(page)).contextState).toBe('suspended')
  const result = await page.evaluate(async () => {
    const probe = (window as ProbeWindow).__stateAudioProbe
    const worker = probe.worker!
    let sequence = 3_000_000
    const rpc = (command: object) =>
      new Promise<Extract<EmulatorMessage, { type: 'reply' }>>((resolve, reject) => {
        const id = sequence++
        const timeout = setTimeout(() => {
          worker.removeEventListener('message', listener)
          reject(new Error('O Worker não respondeu ao teste de estado.'))
        }, 5000)
        const listener = ({ data }: MessageEvent<EmulatorMessage>) => {
          if (data.type !== 'reply' || data.id !== id) return
          clearTimeout(timeout)
          worker.removeEventListener('message', listener)
          if (data.error) reject(new Error(data.error))
          else resolve(data)
        }
        worker.addEventListener('message', listener)
        worker.postMessage({ id, command })
      })
    const saved = (await rpc({ type: 'capture-state' })).checkpoint!
    const contextRate = probe.contexts.at(-1)!.sampleRate
    const foreignRate = contextRate === 44_100 ? 48_000 : 44_100
    // Simula um arquivo exportado em outro dispositivo; a ROM e os canais são os mesmos.
    saved.core.bus.apu.sampling = {
      ...saved.core.bus.apu.sampling,
      rate: foreignRate,
      phase: 0,
      span: 0,
      sumLeft: 0,
      sumRight: 0,
    }
    await rpc({ type: 'load-state', checkpoint: saved })
    const restored = (await rpc({ type: 'capture-state' })).checkpoint!
    // Com a mesma taxa, restauração e play devem preservar a fase parcial de amostragem.
    const matching = structuredClone(restored)
    matching.core.bus.apu.sampling = {
      ...matching.core.bus.apu.sampling,
      rate: contextRate,
      phase: Math.floor(contextRate / 2),
      span: 0,
      sumLeft: 0,
      sumRight: 0,
    }
    await rpc({ type: 'load-state', checkpoint: matching })
    const loaded = (await rpc({ type: 'capture-state' })).checkpoint!
    // O contexto está suspenso e audioDriven não usa timer: play isolado não avança CPU.
    await rpc({ type: 'play', playing: true })
    await rpc({ type: 'play', playing: false })
    const resumed = (await rpc({ type: 'capture-state' })).checkpoint!
    return {
      contextRate,
      foreignRate,
      restoredRate: restored.core.bus.apu.sampling.rate,
      expectedSampling: matching.core.bus.apu.sampling,
      loadedSampling: loaded.core.bus.apu.sampling,
      resumedSampling: resumed.core.bus.apu.sampling,
    }
  })
  expect(result.foreignRate).not.toBe(result.contextRate)
  expect(result.restoredRate).toBe(result.contextRate)
  expect(result.loadedSampling).toEqual(result.expectedSampling)
  expect(result.resumedSampling).toEqual(result.expectedSampling)
})
