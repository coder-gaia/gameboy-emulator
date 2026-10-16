import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

test.use({ hasTouch: true })

async function openGarden(page: Page): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect(canvas).toBeVisible()
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  return canvas
}

async function pixels(canvas: Locator): Promise<string> {
  return canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
}

async function waitFrames(canvas: Locator, count = 3): Promise<void> {
  const initial = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThanOrEqual(initial + count)
}

test('setas movem o personagem, X recentraliza e Z muda a aparência uma vez por pressão', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  const initial = await pixels(canvas)
  await page.keyboard.down('ArrowRight')
  await expect(page.getByRole('button', { name: 'Direita', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect.poll(() => pixels(canvas)).not.toBe(initial)
  await page.keyboard.up('ArrowRight')
  await page.keyboard.down('x')
  await expect.poll(() => pixels(canvas)).toBe(initial)
  await page.keyboard.up('x')
  await waitFrames(canvas)

  await page.keyboard.down('z')
  await expect.poll(() => pixels(canvas)).not.toBe(initial)
  await waitFrames(canvas)
  const changed = await pixels(canvas)
  await page.keyboard.down('z')
  await waitFrames(canvas, 6)
  expect(await pixels(canvas)).toBe(changed)
  await page.keyboard.up('z')
  await waitFrames(canvas)
  await page.keyboard.down('z')
  await expect.poll(() => pixels(canvas)).toBe(initial)
  await page.keyboard.up('z')
})

test('cliques curtos de mouse e toque no botão A chegam ao jogo sem pulso duplicado', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  const initial = await pixels(canvas)
  const button = page.getByRole('button', { name: 'Botão A', exact: true })
  await button.click()
  await expect.poll(() => pixels(canvas)).not.toBe(initial)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await waitFrames(canvas)
  const changed = await pixels(canvas)
  await waitFrames(canvas, 5)
  expect(await pixels(canvas)).toBe(changed)

  await button.tap()
  await expect.poll(() => pixels(canvas)).toBe(initial)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await waitFrames(canvas, 5)
  expect(await pixels(canvas)).toBe(initial)
})

test('soltar o teclado preserva o botão ainda mantido pelo ponteiro', async ({ page }) => {
  const canvas = await openGarden(page)
  const initial = await pixels(canvas)
  const button = page.getByRole('button', { name: 'Botão A', exact: true })
  await page.keyboard.down('z')
  await expect.poll(() => pixels(canvas)).not.toBe(initial)
  await waitFrames(canvas)
  const changed = await pixels(canvas)
  await button.scrollIntoViewIfNeeded()
  const bounds = (await button.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.keyboard.up('z')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await waitFrames(canvas, 5)
  expect(await pixels(canvas)).toBe(changed)
  await page.mouse.move(1, 1)
  await page.mouse.up()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await waitFrames(canvas)
  expect(await pixels(canvas)).toBe(changed)
})

test('dois dedos são independentes e cancelamento, blur e pausa soltam os controles', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  const initial = await pixels(canvas)
  const right = page.getByRole('button', { name: 'Direita', exact: true })
  const button = page.getByRole('button', { name: 'Botão A', exact: true })
  await right.scrollIntoViewIfNeeded()
  await button.scrollIntoViewIfNeeded()
  const rightBounds = (await right.boundingBox())!
  const buttonBounds = (await button.boundingBox())!
  const finger1 = {
    x: rightBounds.x + rightBounds.width / 2,
    y: rightBounds.y + rightBounds.height / 2,
    id: 1,
  }
  const finger2 = {
    x: buttonBounds.x + buttonBounds.width / 2,
    y: buttonBounds.y + buttonBounds.height / 2,
    id: 2,
  }
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger1] })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [finger1, finger2],
  })
  await expect(right).toHaveAttribute('aria-pressed', 'true')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await waitFrames(canvas)
  expect(await pixels(canvas)).not.toBe(initial)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [finger2] })
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(right).toHaveAttribute('aria-pressed', 'true')
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(right).toHaveAttribute('aria-pressed', 'false')

  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger1] })
  await expect(right).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(right).toHaveAttribute('aria-pressed', 'false')
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  await page.keyboard.down('ArrowRight')
  await expect(right).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect(right).toHaveAttribute('aria-pressed', 'false')
  await expect(right).toBeDisabled()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.up('ArrowRight')
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect(right).toBeEnabled()
  await expect(right).toHaveAttribute('aria-pressed', 'false')
  await client.detach()
})

test('a ajuda explica arquivos e limites, pausa o jardim e restaura o foco com Escape', async ({
  page,
}) => {
  await openGarden(page)
  await page.keyboard.down('ArrowRight')
  const help = page.getByRole('button', { name: 'Quais arquivos posso usar?', exact: true })
  await help.click()
  const dialog = page.getByRole('dialog', { name: 'Um arquivo. Um novo mundo.', exact: true })
  await expect(dialog).toBeVisible()
  for (const text of [
    '.gb',
    '.gbc',
    '.zip',
    'ROM Only de 32 KiB',
    '8 MiB',
    'não é enviado para um servidor',
    'BIOS nem boot ROM',
  ]) {
    await expect(dialog).toContainText(text)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(help).toBeFocused()
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Direita', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.keyboard.up('ArrowRight')
})
