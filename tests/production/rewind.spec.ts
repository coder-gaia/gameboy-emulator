import { expect, test } from '@playwright/test'
import { AUDIO_MAX_FRAMES } from '../../src/platform/audio/protocol'
import { expectProductionClean, observeProduction, readProductionProbe } from './probe'

test.beforeEach(async ({ page }) => observeProduction(page))
test.afterEach(async ({ page }) => expectProductionClean(page))

test('rewind da build estática volta o jardim e retoma sem violar CSP', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Ativar rewind', exact: true }).click()
  await expect
    .poll(
      async () => (await readProductionProbe(page)).workers.at(-1)?.rewind?.availableSeconds ?? 0,
    )
    .toBeGreaterThan(0.3)
  const image = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
  await canvas.focus()
  await page.keyboard.down('ArrowRight')
  const frame = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(frame + 90)
  await page.keyboard.up('ArrowRight')
  const before = (await readProductionProbe(page)).workers.at(-1)!.totalTCycles
  await page.keyboard.down('KeyR')
  await expect
    .poll(async () => (await readProductionProbe(page)).workers.at(-1)?.rewind?.active)
    .toBe(true)
  await expect(page.getByRole('button', { name: 'Salvar estado', exact: true })).toBeDisabled()
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL()))
    .toBe(image)
  expect((await readProductionProbe(page)).workers.at(-1)!.totalTCycles).toBeLessThan(before)
  await page.keyboard.up('KeyR')
  await expect
    .poll(async () => (await readProductionProbe(page)).workers.at(-1)?.rewind?.active)
    .toBe(false)
  await expect
    .poll(async () => (await readProductionProbe(page)).workers.at(-1)?.playing)
    .toBe(true)
})

test('AudioWorklet da build limpa PCM ao voltar e retoma áudio real sob CSP', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Jogar 01 Tobu Tobu Girl\./ }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await page.getByRole('button', { name: 'Ativar rewind', exact: true }).click()
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.energy ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  await expect
    .poll(
      async () => (await readProductionProbe(page)).workers.at(-1)?.rewind?.availableSeconds ?? 0,
    )
    .toBeGreaterThan(0.5)
  const before = await readProductionProbe(page)
  await canvas.focus()
  await page.keyboard.down('KeyR')
  await expect
    .poll(async () => (await readProductionProbe(page)).contexts[0]?.state)
    .toBe('suspended')
  await expect.poll(async () => (await readProductionProbe(page)).latestAudio?.queuedFrames).toBe(0)
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.epoch ?? 0)
    .toBeGreaterThan(before.latestAudio!.epoch)
  await expect
    .poll(async () => (await readProductionProbe(page)).workers.at(-1)?.totalTCycles ?? 0)
    .toBeLessThan(before.workers.at(-1)!.totalTCycles)
  await page.keyboard.up('KeyR')
  await expect
    .poll(async () => (await readProductionProbe(page)).contexts[0]?.state)
    .toBe('running')
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.energy ?? 0)
    .toBeGreaterThan(0)
  const after = await readProductionProbe(page)
  expect(after.contexts).toHaveLength(1)
  expect(after.nodeCount).toBe(1)
  expect(after.latestAudio!.queuedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
})
