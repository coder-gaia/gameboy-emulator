import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BATTERY_STORE_NAME } from '../../src/platform/storage/schema'
import { buildTestRom } from '../fixtures/rom'
import { observeProduction, readProductionProbe } from '../production/probe'

test.beforeEach(async ({ page }) => observeProduction(page))

const worker = async (page: Page) => (await readProductionProbe(page)).workers.at(-1)!

async function enable(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ativar rewind', exact: true }).click()
  await expect
    .poll(async () => (await worker(page)).rewind?.availableSeconds ?? 0)
    .toBeGreaterThan(0.5)
}

test('falha ao suspender áudio após iniciar rewind encerra o gesto e permite continuar', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Jogar 01 Tobu Tobu Girl\./ }).click()
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.energy ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  await enable(page)
  await page.evaluate(() => {
    const suspend = AudioContext.prototype.suspend
    let rejected = false
    AudioContext.prototype.suspend = function () {
      const probe = (
        window as Window & {
          __productionProbe?: {
            workers: { rewind?: { active: boolean } | null }[]
          }
        }
      ).__productionProbe
      if (!rejected && probe?.workers.at(-1)?.rewind?.active) {
        rejected = true
        return Promise.reject(new DOMException('Falha controlada no suspend', 'InvalidStateError'))
      }
      return suspend.call(this)
    }
  })
  await page.getByLabel('Tela do emulador', { exact: true }).focus()
  await page.keyboard.down('KeyR')
  await expect(page.getByRole('status', { name: 'Estado do rewind' })).toContainText(
    'Não foi possível suspender',
  )
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(false)
  await expect.poll(async () => (await worker(page)).playing).toBe(false)
  await page.keyboard.up('KeyR')
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect.poll(async () => (await worker(page)).playing).toBe(true)
  await expect
    .poll(async () => (await readProductionProbe(page)).contexts[0]?.state)
    .toBe('running')
})

interface DelayedBattery {
  delay: boolean
  waiting: boolean
  release: (() => void) | null
}
type DelayedWindow = Window & typeof globalThis & { __delayedBattery: DelayedBattery }

test('bateria lenta mantém controles bloqueados e cancelamento impede retomada posterior', async ({
  page,
}) => {
  await page.addInitScript(
    ({ storeName }) => {
      const state: DelayedBattery = { delay: false, waiting: false, release: null }
      ;(window as DelayedWindow).__delayedBattery = state
      const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
        ...descriptor,
        set(callback: ((this: IDBTransaction, event: Event) => unknown) | null) {
          descriptor.set!.call(
            this,
            callback === null
              ? null
              : function (this: IDBTransaction, event: Event) {
                  if (
                    state.delay &&
                    this.mode === 'readwrite' &&
                    this.objectStoreNames.contains(storeName)
                  ) {
                    state.delay = false
                    state.waiting = true
                    state.release = () => {
                      state.waiting = false
                      state.release = null
                      callback.call(this, event)
                    }
                  } else callback.call(this, event)
                },
          )
        },
      })
    },
    { storeName: BATTERY_STORE_NAME },
  )
  await page.goto('/')
  const rom = buildTestRom({
    title: 'SLOW REWIND',
    cartridgeType: 3,
    ramSizeCode: 2,
    program: [
      0xf3, 0x3e, 0x0a, 0xea, 0, 0, 0x21, 0, 0xa0, 0x36, 0, 0x34, 0x11, 0xff, 0xff, 0x1b, 0x7a,
      0xb3, 0x20, 0xfb, 0x18, 0xf5,
    ],
  })
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'slow-rewind.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(rom),
  })
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await enable(page)
  await expect
    .poll(async () => (await worker(page)).rewind?.availableSeconds ?? 0)
    .toBeGreaterThan(3)
  const button = page.getByRole('button', { name: 'Segure para voltar', exact: true })
  await button.scrollIntoViewIfNeeded()
  const box = (await button.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(true)
  await expect.poll(async () => (await worker(page)).rewind?.entries, { timeout: 8000 }).toBe(1)
  await page.evaluate(() => {
    ;(window as DelayedWindow).__delayedBattery.delay = true
  })
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => (window as DelayedWindow).__delayedBattery.waiting))
    .toBe(true)
  await expect.poll(async () => (await worker(page)).rewind?.active).toBe(false)
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Salvar estado', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Trocar cartucho/ })).toBeDisabled()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    ;(window as DelayedWindow).__delayedBattery.release?.()
  })
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeEnabled()
  await expect.poll(async () => (await worker(page)).playing).toBe(false)
  const paused = (await worker(page)).totalTCycles
  await page.waitForTimeout(200)
  expect((await worker(page)).totalTCycles).toBe(paused)
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect.poll(async () => (await worker(page)).totalTCycles).toBeGreaterThan(paused)
})
