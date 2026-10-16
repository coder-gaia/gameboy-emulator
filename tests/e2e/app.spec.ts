import { expect, test } from '@playwright/test'

test('abre a apresentação e fecha pelo teclado', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sobre', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Sobre', exact: true })).toBeFocused()
})

test('troca a paleta com estado acessível', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Pocket', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pocket', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'DMG', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('mantém a interface dentro de uma tela estreita', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/')
  const width = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }))
  expect(width.content).toBeLessThanOrEqual(width.viewport)
  await expect(page.getByRole('button', { name: 'Sobre', exact: true })).toBeVisible()
})
