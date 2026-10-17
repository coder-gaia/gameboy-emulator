import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { observeProduction, readProductionProbe } from '../production/probe'

test.use({ hasTouch: true })
test.beforeEach(async ({ page }) => observeProduction(page))

async function worker(page: Page) {
  return (await readProductionProbe(page)).workers.at(-1)!
}

async function pixels(canvas: Locator): Promise<string> {
  return canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
}

async function waitFrames(canvas: Locator, count: number): Promise<void> {
  const initial = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThanOrEqual(initial + count)
}

async function hold(page: Page, button: Locator, touch: boolean): Promise<() => Promise<void>> {
  const box = (await button.boundingBox())!
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }
  if (touch) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    return async () => {
      // A captura precisa continuar funcionando mesmo ao soltar fora do botão.
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 1, y: 1, id: 1 }],
      })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await session.detach()
    }
  }
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  return async () => {
    await page.mouse.move(1, 1)
    await page.mouse.up()
  }
}

async function expectUsable(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await expect(locator).toBeEnabled()
  expect(
    await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const width = window.innerWidth
      const height = window.innerHeight
      const target = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      )
      return {
        inside:
          bounds.left >= -1 &&
          bounds.top >= -1 &&
          bounds.right <= width + 1 &&
          bounds.bottom <= height + 1,
        unobscured: target !== null && (target === element || element.contains(target)),
      }
    }),
  ).toEqual({ inside: true, unobscured: true })
}

async function expectFullscreenFit(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const element = document.fullscreenElement!
    return {
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight,
    }
  })
  expect(overflow.horizontal).toBeLessThanOrEqual(1)
  expect(overflow.vertical).toBeLessThanOrEqual(1)
  for (const name of [
    'Cima',
    'Baixo',
    'Esquerda',
    'Direita',
    'Botão A',
    'Botão B',
    'Start',
    'Select',
  ]) {
    await expectUsable(page.getByRole('button', { name, exact: true }))
  }
  for (const name of ['Pausar', 'Reiniciar', 'Sair da tela cheia', 'Ativar som']) {
    await expectUsable(page.getByRole('button', { name, exact: true }))
  }
  await expectUsable(page.getByRole('slider', { name: 'Volume', exact: true }))
}

for (const viewport of [
  { name: 'retrato', width: 390, height: 844 },
  { name: 'paisagem', width: 844, height: 390 },
]) {
  test(`rewind compacto em tela cheia ${viewport.name} mantém toque e controles acessíveis`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(45_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
    const canvas = page.getByLabel('Tela do emulador', { exact: true })
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
      .toBeGreaterThan(3)
    await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('jogar')
    await expectFullscreenFit(page)
    const toggle = page.getByRole('button', { name: 'Ativar rewind', exact: true })
    await expectUsable(toggle)
    await toggle.click()
    const rewind = page.getByRole('button', { name: 'Segure para voltar', exact: true })
    const duration = page.getByLabel('Tempo disponível para rewind', { exact: true })
    await expect(duration).toHaveAttribute('aria-live', 'off')
    await expect(page.getByRole('button', { name: 'Desativar rewind', exact: true })).toBeHidden()
    await expect
      .poll(async () => (await worker(page)).rewind?.availableSeconds ?? 0)
      .toBeGreaterThan(0.5)
    await expectUsable(rewind)
    const initialImage = await pixels(canvas)
    const touch = testInfo.project.name === 'mobile'
    const releaseDirection = await hold(
      page,
      page.getByRole('button', { name: 'Direita', exact: true }),
      touch,
    )
    await waitFrames(canvas, 36)
    await releaseDirection()
    await expect(page.getByRole('button', { name: 'Direita', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect.poll(() => pixels(canvas)).not.toBe(initialImage)
    await expect
      .poll(async () => (await worker(page)).rewind?.availableSeconds ?? 0)
      .toBeGreaterThan(1)
    const before = await worker(page)
    const releaseRewind = await hold(page, rewind, touch)
    await expect.poll(async () => (await worker(page)).rewind?.active).toBe(true)
    await expect(rewind).toBeEnabled()
    await expect
      .poll(async () => (await worker(page)).rewindRestores)
      .toBeGreaterThan(before.rewindRestores)
    await expect.poll(() => pixels(canvas), { timeout: 8000 }).toBe(initialImage)
    expect((await worker(page)).totalTCycles).toBeLessThan(before.totalTCycles)
    await expect(rewind).toBeEnabled()
    await releaseRewind()
    await expect.poll(async () => (await worker(page)).rewind?.active).toBe(false)
    await expect.poll(async () => (await worker(page)).playing).toBe(true)
    await expectFullscreenFit(page)
    await expect(duration).toBeVisible()
    const volume = page.getByRole('slider', { name: 'Volume', exact: true })
    await volume.focus()
    const previousVolume = Number(await volume.inputValue())
    await page.keyboard.press('ArrowLeft')
    await expect(volume).toHaveValue(String(previousVolume - 1))
    await page.screenshot({ path: testInfo.outputPath(`rewind-${viewport.name}.png`) })
    await page.getByRole('button', { name: 'Sair da tela cheia', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null)
    await expect(page.getByRole('button', { name: 'Desativar rewind', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ativar rewind', exact: true })).toHaveCount(0)
  })
}
