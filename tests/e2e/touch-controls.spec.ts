import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const DIRECTIONS = ['Cima', 'Baixo', 'Esquerda', 'Direita']
const CONTROLS = [...DIRECTIONS, 'Botão A', 'Botão B', 'Start', 'Select']

async function openGarden(page: Page): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  return canvas
}

async function expectTouchLayout(page: Page, directionalSize: number): Promise<void> {
  const viewport = page.viewportSize()!
  const group = page.getByRole('group', { name: 'Controles do Game Boy', exact: true })
  await group.scrollIntoViewIfNeeded()
  const boxes = []
  for (const name of CONTROLS) {
    const button = group.getByRole('button', { name, exact: true })
    const box = (await button.boundingBox())!
    const expectedSize = DIRECTIONS.includes(name) ? directionalSize : 44
    expect(box.width, `${name}: largura`).toBe(expectedSize)
    expect(box.height, `${name}: altura`).toBe(expectedSize)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(
      await button.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )
        return hit !== null && (hit === element || element.contains(hit))
      }),
      `${name}: alvo livre para toque`,
    ).toBe(true)
    boxes.push(box)
  }
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first]!
      const b = boxes[second]!
      const horizontal = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const vertical = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      expect(horizontal > 0 && vertical > 0, `${CONTROLS[first]} e ${CONTROLS[second]}`).toBe(false)
    }
  }
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  const icon = group.getByRole('button', { name: 'Cima', exact: true }).locator('svg')
  expect((await icon.boundingBox())!.width).toBe(coarse ? 22 : 18)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  )
}

for (const width of [320, 360, 390, 844]) {
  test(`direcionais em ${width} px preservam alvos livres e ampliam o toque quando há espaço`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openGarden(page)
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    await expectTouchLayout(page, coarse && width > 320 ? 52 : 44)
  })
}

for (const viewport of [
  { name: 'retrato estreito', width: 320, height: 740 },
  { name: 'retrato', width: 390, height: 844 },
  { name: 'paisagem curta', width: 640, height: 360 },
  { name: 'paisagem estreita', width: 740, height: 360 },
  { name: 'paisagem', width: 844, height: 390 },
]) {
  test(`direcionais maiores cabem em tela cheia ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const canvas = await openGarden(page)
    await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('jogar')
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    await expectTouchLayout(page, coarse && viewport.width > 320 ? 52 : 44)
    await expect(page.getByRole('button', { name: 'Ativar rewind', exact: true })).toBeVisible()
    for (const name of [
      'Pausar',
      'Reiniciar',
      'Sair da tela cheia',
      'Ativar som',
      'Ativar rewind',
    ]) {
      const button = page.getByRole('button', { name, exact: true })
      const box = (await button.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    }
    const screen = (await canvas.boundingBox())!
    expect(screen.y).toBeGreaterThanOrEqual(0)
    expect(screen.y + screen.height).toBeLessThanOrEqual(viewport.height)
    expect(
      await page.evaluate(() => {
        const element = document.fullscreenElement!
        return {
          horizontal: element.scrollWidth - element.clientWidth,
          vertical: element.scrollHeight - element.clientHeight,
        }
      }),
    ).toEqual({ horizontal: 0, vertical: 0 })
    await page.getByRole('button', { name: 'Sair da tela cheia', exact: true }).click()
  })
}

test.describe('captura dos direcionais ampliados', () => {
  test.use({ hasTouch: true })

  test('mantém a direção ao arrastar para fora e solta sem afetar outro dedo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const canvas = await openGarden(page)
    const right = page.getByRole('button', { name: 'Direita', exact: true })
    const up = page.getByRole('button', { name: 'Cima', exact: true })
    await right.scrollIntoViewIfNeeded()
    const rightBox = (await right.boundingBox())!
    const upBox = (await up.boundingBox())!
    const finger1 = {
      x: rightBox.x + rightBox.width / 2,
      y: rightBox.y + rightBox.height / 2,
      id: 1,
    }
    const finger2 = { x: upBox.x + upBox.width / 2, y: upBox.y + upBox.height / 2, id: 2 }
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [finger1, finger2],
    })
    await expect(right).toHaveAttribute('aria-pressed', 'true')
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    const initialFrame = Number(await canvas.getAttribute('data-frame-id'))
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
      .toBeGreaterThan(initialFrame + 6)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 1, y: 1, id: 1 }, finger2],
    })
    await expect(right).toHaveAttribute('aria-pressed', 'true')
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: 1, y: 1, id: 1 }],
    })
    await expect(right).toHaveAttribute('aria-pressed', 'false')
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect(up).toHaveAttribute('aria-pressed', 'false')
    await session.detach()
  })
})
