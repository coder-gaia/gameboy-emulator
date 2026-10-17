import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { EmulatorMessage } from '../../src/runtime/worker-protocol'
import { buildTestRom } from '../fixtures/rom'
import {
  BATTERY_STORE_NAME,
  SAVE_DATABASE_NAME,
  SAVE_DATABASE_VERSION,
} from '../../src/platform/storage/schema'

interface WorkerProbe {
  created: number
  terminated: number
  live: Map<number, Worker>
  completed: number
  target: number
  rafDuringBusy: number
  completedAtClick: number | null
  last: Map<number, { frameId: number; cycles: number; serial: string; playing: boolean }>
}

type ProbeWindow = Window & typeof globalThis & { __workerProbe: WorkerProbe }

async function observeWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: WorkerProbe = {
      created: 0,
      terminated: 0,
      live: new Map(),
      completed: 0,
      target: 0,
      rafDuringBusy: 0,
      completedAtClick: null,
      last: new Map(),
    }
    ;(window as ProbeWindow).__workerProbe = probe
    const NativeWorker = window.Worker
    class ObservedWorker extends NativeWorker {
      private readonly probeId: number

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.probeId = ++probe.created
        probe.live.set(this.probeId, this)
        this.addEventListener('message', (event: MessageEvent<EmulatorMessage>) => {
          const message = event.data
          if (message.type === 'reply' && message.id >= 1_000_000) probe.completed += 1
          if ('snapshot' in message && message.snapshot) {
            probe.last.set(this.probeId, {
              frameId: message.snapshot.frameId,
              cycles: message.snapshot.cpu.totalTCycles,
              serial: message.snapshot.serial,
              playing: message.snapshot.playing,
            })
          }
        })
      }

      override terminate(): void {
        if (probe.live.delete(this.probeId)) probe.terminated += 1
        super.terminate()
      }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, value: ObservedWorker })
  })
}

test('Worker real preserva serial, pausa, passos de CPU e descarte ao reiniciar ou trocar', async ({
  page,
}) => {
  await observeWorkers(page)
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Experimentar cartucho de diagnóstico', exact: true })
    .click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('0100')
  await page.getByRole('button', { name: 'Uma instrução', exact: true }).click()
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('0150')
  await page.getByRole('button', { name: 'Até 1000 instruções', exact: true }).click()
  await expect(page.getByLabel('Saída serial', { exact: true })).toHaveText('OK')
  await expect(page.getByLabel('Estado da CPU', { exact: true })).toHaveText('HALT')
  expect(await page.evaluate(() => (window as ProbeWindow).__workerProbe.live.size)).toBe(1)

  await page.getByRole('button', { name: 'Reiniciar CPU', exact: true }).click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('0100')
  await expect(page.getByLabel('Saída serial', { exact: true })).toHaveText('Aguardando saída...')
  await expect
    .poll(() => page.evaluate(() => (window as ProbeWindow).__workerProbe.terminated))
    .toBe(1)

  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => [...(window as ProbeWindow).__workerProbe.last.values()].at(-1)?.playing),
    )
    .toBe(false)
  const frame = await canvas.getAttribute('data-frame-id')
  await page.waitForTimeout(180)
  expect(await canvas.getAttribute('data-frame-id')).toBe(frame)
  const lifecycle = await page.evaluate(() => {
    const probe = (window as ProbeWindow).__workerProbe
    return { created: probe.created, terminated: probe.terminated, live: probe.live.size }
  })
  expect(lifecycle).toEqual({ created: 3, terminated: 2, live: 1 })
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a interface responde enquanto o Worker executa milhões de T-cycles', async ({ page }) => {
  await observeWorkers(page)
  await page.goto('/')
  const rom = buildTestRom({ title: 'BUSY WORKER', program: [0xf3, 0x18, 0xfe] })
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'busy.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(rom),
  })
  await expect(page.getByRole('heading', { name: 'BUSY WORKER', exact: true })).toBeVisible()
  const palette = page.getByRole('button', { name: 'Pocket', exact: true })
  await palette.scrollIntoViewIfNeeded()
  await palette.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        const probe = (window as ProbeWindow).__workerProbe
        probe.completedAtClick = probe.completed
      },
      { once: true },
    )
  })
  await page.evaluate(() => {
    const probe = (window as ProbeWindow).__workerProbe
    const worker = [...probe.live.values()][0]!
    probe.target = 2000
    const animate = () => {
      if (probe.completed < probe.target) {
        probe.rafDuringBusy += 1
        requestAnimationFrame(animate)
      }
    }
    requestAnimationFrame(animate)
    for (let index = 0; index < probe.target; index += 1) {
      worker.postMessage({ id: 1_000_000 + index, command: { type: 'step', count: 1000 } })
    }
  })
  await palette.click()
  await expect(palette).toHaveAttribute('aria-pressed', 'true')
  const during = await page.evaluate(() => {
    const probe = (window as ProbeWindow).__workerProbe
    return {
      completedAtClick: probe.completedAtClick,
      target: probe.target,
      raf: probe.rafDuringBusy,
    }
  })
  expect(during.completedAtClick).not.toBeNull()
  expect(during.completedAtClick!).toBeLessThan(during.target)
  expect(during.raf).toBeGreaterThan(0)
  await expect
    .poll(() => page.evaluate(() => (window as ProbeWindow).__workerProbe.completed), {
      timeout: 15_000,
    })
    .toBe(2000)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('LCD desligado continua publicando CPU, serial e bateria sem depender de quadros', async ({
  page,
}) => {
  await observeWorkers(page)
  await page.goto('/')
  const rom = buildTestRom({
    title: 'LCD OFF WORKER',
    cartridgeType: 3,
    ramSizeCode: 2,
    program: [
      0xf3, 0xaf, 0xe0, 0x40, 0x3e, 0x0a, 0xea, 0, 0, 0x3e, 7, 0xea, 0, 0xa0, 0x3e, 0x48, 0xe0, 1,
      0x3e, 0x81, 0xe0, 2, 0x76,
    ],
  })
  const id = createHash('sha256').update(rom).digest('hex')
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'lcd-off.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(rom),
  })
  await expect(page.getByRole('heading', { name: 'LCD OFF WORKER', exact: true })).toBeVisible()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect(page.getByLabel('Saída serial', { exact: true })).toHaveText('H')
  await expect(page.getByLabel('Estado da CPU', { exact: true })).toHaveText('HALT')
  await expect(page.getByLabel('Tela do emulador', { exact: true })).toHaveAttribute(
    'data-frame-id',
    '0',
  )
  await expect
    .poll(async () =>
      Number(await page.getByLabel('T-cycles executados', { exact: true }).textContent()),
    )
    .toBeGreaterThan(4096)
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ databaseName, storeName, version, id }) =>
            new Promise<number | null>((resolve, reject) => {
              const request = indexedDB.open(databaseName, version)
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const database = request.result
                const transaction = database.transaction(storeName)
                const get = transaction.objectStore(storeName).get(id)
                transaction.onabort = () => {
                  database.close()
                  reject(transaction.error)
                }
                transaction.oncomplete = () => {
                  database.close()
                  const record = get.result as { bytes: ArrayBuffer } | undefined
                  resolve(record ? new Uint8Array(record.bytes)[0]! : null)
                }
              }
            }),
          {
            databaseName: SAVE_DATABASE_NAME,
            storeName: BATTERY_STORE_NAME,
            version: SAVE_DATABASE_VERSION,
            id,
          },
        ),
      { timeout: 7000 },
    )
    .toBe(7)
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('Worker entrega PCM já produzido, mantém o relógio interativo e descarta gerações antigas', async ({
  page,
}) => {
  await observeWorkers(page)
  await page.goto('/')
  const program = [0xf3]
  for (const [register, value] of [
    [0x26, 0x80],
    [0x24, 0x77],
    [0x25, 0x11],
    [0x11, 0x80],
    [0x12, 0xf3],
    [0x13, 0x00],
    [0x14, 0x87],
  ]) {
    program.push(0x3e, value!, 0xe0, register!)
  }
  program.push(0x18, 0xfe)
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'pcm-worker.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(buildTestRom({ title: 'PCM WORKER', program })),
  })
  await expect(page.getByRole('heading', { name: 'PCM WORKER', exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const worker = [...(window as ProbeWindow).__workerProbe.live.values()][0]!
    const channel = new MessageChannel()
    let sequence = 2_000_000
    const rpc = (command: object, transfer: Transferable[] = []) =>
      new Promise<NonNullable<Extract<EmulatorMessage, { type: 'reply' }>['snapshot']>>(
        (resolve, reject) => {
          const id = sequence++
          const timeout = setTimeout(() => {
            worker.removeEventListener('message', listener)
            reject(new Error('Worker não respondeu.'))
          }, 5000)
          const listener = ({ data }: MessageEvent<EmulatorMessage>) => {
            if (data.type !== 'reply' || data.id !== id) return
            clearTimeout(timeout)
            worker.removeEventListener('message', listener)
            if (data.error || !data.snapshot) reject(new Error(data.error ?? 'Snapshot ausente.'))
            else resolve(data.snapshot)
          }
          worker.addEventListener('message', listener)
          worker.postMessage({ id, command }, transfer)
        },
      )
    const received: { epoch: number; samples: Float32Array }[] = []
    channel.port2.onmessage = ({ data }: MessageEvent<{ epoch: number; samples: Float32Array }>) =>
      received.push(data)
    channel.port2.start()
    const waitForSamples = () =>
      new Promise<void>((resolve, reject) => {
        const initial = received.length
        const deadline = performance.now() + 5000
        const poll = () => {
          if (received.length > initial) resolve()
          else if (performance.now() > deadline) reject(new Error('PCM não recebido.'))
          else setTimeout(poll, 5)
        }
        poll()
      })
    const initial = await rpc({ type: 'inspect' })
    await rpc(
      {
        type: 'audio-port',
        port: channel.port1,
        sampleRate: 48_000,
        epoch: initial.audioEpoch + 1,
      },
      [channel.port1],
    )
    const started = await rpc({ type: 'play', playing: true })
    let waiting = waitForSamples()
    channel.port2.postMessage({ type: 'need', frames: 1536, epoch: started.audioEpoch })
    await waiting
    const afterFirst = await rpc({ type: 'inspect' })
    const paused = await rpc({ type: 'play', playing: false })
    const beforeStale = received.length
    channel.port2.postMessage({ type: 'need', frames: 512, epoch: started.audioEpoch })
    channel.port2.postMessage({ type: 'need', frames: 512, epoch: paused.audioEpoch })
    await new Promise((resolve) => setTimeout(resolve, 60))
    const whilePaused = await rpc({ type: 'inspect' })
    const resumed = await rpc({ type: 'play', playing: true })
    channel.port2.postMessage({ type: 'need', frames: 512, epoch: started.audioEpoch })
    channel.port2.postMessage({ type: 'need', frames: 512, epoch: paused.audioEpoch })
    await new Promise((resolve) => setTimeout(resolve, 60))
    const afterStale = await rpc({ type: 'inspect' })
    const staleResponses = received.length - beforeStale
    waiting = waitForSamples()
    channel.port2.postMessage({ type: 'need', frames: 512, epoch: resumed.audioEpoch })
    await waiting
    const afterFresh = await rpc({ type: 'inspect' })
    const summary = {
      firstFrames: received[0]!.samples.length / 2,
      firstEpoch: received[0]!.epoch,
      startedEpoch: started.audioEpoch,
      resumedEpoch: resumed.audioEpoch,
      firstCycles: afterFirst.cpu.totalTCycles - started.cpu.totalTCycles,
      staleResponses,
      pausedCycles: whilePaused.cpu.totalTCycles - paused.cpu.totalTCycles,
      staleCycles: afterStale.cpu.totalTCycles - paused.cpu.totalTCycles,
      freshFrames: received.at(-1)!.samples.length / 2,
      freshEpoch: received.at(-1)!.epoch,
      freshCycles: afterFresh.cpu.totalTCycles - afterStale.cpu.totalTCycles,
      finite: received.every((entry) => entry.samples.every(Number.isFinite)),
      audible: received[0]!.samples.some((sample) => Math.abs(sample) > 0.001),
    }
    await rpc({ type: 'play', playing: false })
    channel.port2.close()
    return summary
  })
  expect(result.firstFrames).toBeGreaterThan(0)
  expect(result.firstFrames).toBeLessThanOrEqual(1536)
  expect(result.firstCycles).toBeGreaterThan(0)
  expect(result.firstEpoch).toBe(result.startedEpoch)
  expect(result.staleResponses).toBe(0)
  expect(result.pausedCycles).toBe(0)
  // A demanda não comanda o relógio da máquina: jogar continua sem pedidos válidos.
  expect(result.staleCycles).toBeGreaterThan(0)
  expect(result.freshFrames).toBeGreaterThan(0)
  expect(result.freshFrames).toBeLessThanOrEqual(512)
  expect(result.freshEpoch).toBe(result.resumedEpoch)
  expect(result.freshEpoch).toBeGreaterThan(result.firstEpoch)
  expect(result.freshCycles).toBeGreaterThanOrEqual(0)
  expect(result.finite).toBe(true)
  expect(result.audible).toBe(true)
})
