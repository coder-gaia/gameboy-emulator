import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      elements: violation.nodes.map((node) => ({
        html: node.html,
        reason: node.failureSummary,
      })),
    })),
  ).toEqual([])
}

test('não apresenta violações automáticas na página inicial', async ({ page }) => {
  await page.goto('/')
  await expectAccessible(page)
  await page.getByText('Controles e créditos dos jogos', { exact: true }).click()
  await expectAccessible(page)
})

test('não apresenta violações com jogo, slots e inspeção abertos', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByLabel('Tela do emulador', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.getByRole('button', { name: 'Salvar estado', exact: true }).click()
  await expect(page.getByLabel('Estado dos slots', { exact: true })).toContainText('Estado salvo')
  await expectAccessible(page)
})

for (const dialog of [
  { trigger: 'Sobre', title: 'Uma ideia que cabe no bolso.' },
  { trigger: 'Quais arquivos posso usar?', title: 'Um arquivo. Um novo mundo.' },
]) {
  test(`mantém o diálogo ${dialog.trigger} acessível e devolve o foco`, async ({ page }) => {
    await page.goto('/')
    const trigger = page.getByRole('button', { name: dialog.trigger, exact: true })
    await trigger.click()
    const modal = page.getByRole('dialog', { name: dialog.title })
    await expect(modal).toBeVisible()
    await expectAccessible(page)
    await trigger.focus()
    expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Tab')
    // O diálogo nativo pode enviar Tab à barra do navegador depois do último
    // controle. Nenhum elemento da página ao fundo pode receber o foco.
    expect(
      await modal.evaluate(
        (element) =>
          document.activeElement === document.body || element.contains(document.activeElement),
      ),
    ).toBe(true)
    await page.keyboard.press('Shift+Tab')
    expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    await expect(trigger).toBeFocused()
  })
}

test('oferece foco visível no jogo, nos detalhes e nos slots por teclado', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect(canvas).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(canvas).toBeFocused()
  expect(await canvas.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  const summary = page.getByText('Inspecionar CPU', { exact: true })
  await summary.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  expect(await summary.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Registrador PC', { exact: true })).toBeVisible()
  const slot = page.getByRole('radio', { name: 'Slot 1', exact: true })
  await slot.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Slot 2', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Slot 2', exact: true })).toBeFocused()
  expect(
    await page
      .getByRole('radio', { name: 'Slot 2', exact: true })
      .evaluate((element) => getComputedStyle(element.closest('label')!).outlineStyle),
  ).toBe('solid')
})

test('permite abrir detalhes pelo teclado durante uma partida', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByLabel('Tela do emulador', { exact: true })).toBeFocused()
  const summary = page.getByText('Inspecionar CPU', { exact: true })
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Registrador PC', { exact: true })).toBeVisible()
})

test('mantém preferências acessíveis com os oito campos de teclado expostos', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Controles e preferências', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Tecla para Cima', exact: true })).toBeVisible()
  await expectAccessible(page)
  const field = page.getByRole('textbox', { name: 'Tecla para Cima', exact: true })
  await field.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Tecla para Baixo', exact: true })).toBeFocused()
})

for (const width of [320, 390, 1440]) {
  test(`acomoda jogo, controles e slots em ${width} px sem recortar alvos`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
    await expect(page.getByLabel('Tela do emulador', { exact: true })).toBeVisible()
    await page.getByText('Inspecionar CPU', { exact: true }).click()
    await page.getByText('Controles e preferências', { exact: true }).click()
    await page.getByText('Controles e créditos dos jogos', { exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    const targets = page
      .getByRole('group', { name: 'Controles do Game Boy', exact: true })
      .getByRole('button')
    for (const target of await targets.all()) {
      const box = await target.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
    await expect(page.getByRole('button', { name: 'Importar estado', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Tecla para Start', exact: true })).toBeVisible()
  })
}

test('respeita movimento reduzido e mantém controles legíveis', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByLabel('Tela do emulador', { exact: true })).toBeVisible()
  const transition = await page
    .getByRole('button', { name: 'Botão A', exact: true })
    .evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(transition.split(',').every((duration) => Number.parseFloat(duration) <= 0.00001)).toBe(
    true,
  )
  await expectAccessible(page)
})
