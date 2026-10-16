import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { AudioStreamDiagnostics } from '../../src/platform/audio/protocol'

interface AudioCommandProbe {
  type: string
  epoch?: number
  active?: boolean
}

interface AudioProbe {
  contexts: AudioContext[]
  gains: GainNode[]
  nodes: AudioWorkletNode[]
  stats: AudioStreamDiagnostics[]
  commands: AudioCommandProbe[]
}

type ProbedWindow = Window & typeof globalThis & { __audioProbe: AudioProbe }

async function instrumentAudio(page: Page, unavailable = false): Promise<void> {
  await page.addInitScript(
    ({ unavailable }) => {
      const probe: AudioProbe = { contexts: [], gains: [], nodes: [], stats: [], commands: [] }
      ;(window as ProbedWindow).__audioProbe = probe
      const NativeContext = window.AudioContext
      window.AudioContext = class extends NativeContext {
        constructor(options?: AudioContextOptions) {
          super(options)
          probe.contexts.push(this)
        }
        createGain(): GainNode {
          const gain = super.createGain()
          probe.gains.push(gain)
          return gain
        }
      }
      if (unavailable) {
        Object.defineProperty(window.AudioContext.prototype, 'audioWorklet', {
          configurable: true,
          get: () => undefined,
        })
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
            if (message !== null && typeof message === 'object') {
              const value = message as Record<string, unknown>
              probe.commands.push({
                type: String(value.type),
                epoch: typeof value.epoch === 'number' ? value.epoch : undefined,
                active: typeof value.active === 'boolean' ? value.active : undefined,
              })
            }
            Reflect.apply(send, this, [message, options])
          }
        }
      }
    },
    { unavailable },
  )
}

async function readProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ProbedWindow).__audioProbe
    return {
      contexts: probe.contexts.map((context) => ({
        state: context.state,
        sampleRate: context.sampleRate,
      })),
      nodeCount: probe.nodes.length,
      gain: probe.gains.at(-1)?.gain.value ?? 0,
      latest: probe.stats.at(-1) ?? null,
      commands: probe.commands,
    }
  })
}

async function openTobu(page: Page): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Jogar Tobu Tobu Girl', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  return canvas
}

async function enableAudio(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Silenciar', exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await readProbe(page)).latest?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
}

test('PCM real chega ao Worklet e mute, volume e pausas rápidas preservam a reprodução', async ({
  page,
}) => {
  await instrumentAudio(page)
  const canvas = await openTobu(page)
  await enableAudio(page)
  await expect
    .poll(async () => (await readProbe(page)).latest?.energy ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0)
  expect((await readProbe(page)).latest!.queuedFrames).toBeLessThanOrEqual(16_384)
  expect((await readProbe(page)).contexts.at(-1)!.state).toBe('running')

  const slider = page.getByRole('slider', { name: 'Volume', exact: true })
  await slider.focus()
  await page.keyboard.press('Home')
  for (let step = 0; step < 25; step += 1) await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveValue('25')
  await expect.poll(async () => (await readProbe(page)).gain).toBe(0.25)
  await page.getByRole('button', { name: 'Silenciar', exact: true }).click()
  await expect.poll(async () => (await readProbe(page)).gain).toBe(0)
  const mutedFrame = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(mutedFrame + 3)
  expect((await readProbe(page)).contexts.at(-1)!.state).toBe('running')
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect.poll(async () => (await readProbe(page)).gain).toBe(0.25)

  const beforePause = (await readProbe(page)).latest!.epoch
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(async () => (await readProbe(page)).contexts.at(-1)?.state).toBe('suspended')
  await expect.poll(async () => (await readProbe(page)).latest?.queuedFrames).toBe(0)
  expect((await readProbe(page)).latest!.epoch).toBeGreaterThan(beforePause)
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  for (let repeat = 0; repeat < 3; repeat += 1) {
    await page.getByRole('button', { name: 'Pausar', exact: true }).click()
    await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  }
  await expect
    .poll(async () => (await readProbe(page)).latest?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
  await expect(page.getByRole('status', { name: 'Estado do áudio', exact: true })).toHaveCount(0)
  expect((await readProbe(page)).contexts).toHaveLength(1)
})

test('trocar e reiniciar o cartucho limpa a trilha anterior sem recriar o contexto', async ({
  page,
}) => {
  await instrumentAudio(page)
  await openTobu(page)
  await enableAudio(page)
  await expect
    .poll(async () => (await readProbe(page)).latest?.energy ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'POCKET GARDEN', exact: true })).toBeVisible()
  await expect
    .poll(
      async () =>
        (await readProbe(page)).commands.filter((command) => command.type === 'connect').length,
    )
    .toBe(2)
  await expect
    .poll(async () => (await readProbe(page)).latest?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
  expect((await readProbe(page)).latest!.energy).toBe(0)

  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  await expect
    .poll(
      async () =>
        (await readProbe(page)).commands.filter((command) => command.type === 'connect').length,
    )
    .toBe(3)
  await expect.poll(async () => (await readProbe(page)).contexts.at(-1)?.state).toBe('suspended')
  expect((await readProbe(page)).latest!.queuedFrames).toBe(0)
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect
    .poll(async () => (await readProbe(page)).latest?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
  expect((await readProbe(page)).latest!.energy).toBe(0)
  expect((await readProbe(page)).contexts).toHaveLength(1)
  expect((await readProbe(page)).nodeCount).toBe(1)
})

test('sem AudioWorklet o jogo segue funcionando e a mensagem explica o som indisponível', async ({
  page,
}) => {
  await instrumentAudio(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  const initial = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado do áudio', exact: true })).toContainText(
    'O jogo continua sem som',
  )
  await expect(page.getByRole('status', { name: 'Estado do áudio', exact: true })).toContainText(
    'AudioWorklet',
  )
  await expect(page.getByRole('button', { name: 'Ativar som', exact: true })).toBeEnabled()
  await page.keyboard.down('ArrowRight')
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL()))
    .not.toBe(initial)
  await page.keyboard.up('ArrowRight')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect((await readProbe(page)).contexts.at(-1)!.state).toBe('closed')
  expect((await readProbe(page)).nodeCount).toBe(0)
})
