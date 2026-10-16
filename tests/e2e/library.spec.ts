import { expect, test } from '@playwright/test'
import { DEMO_GAMES } from '../../src/platform/games/catalog'

for (const game of DEMO_GAMES) {
  test(`abre ${game.title} sem arquivo e deixa o teclado pronto para jogar`, async ({ page }) => {
    await page.goto('/')
    const choice = page.getByRole('button', {
      name: new RegExp(`^Jogar \\d{2} ${game.title}\\.`),
    })
    await choice.click()
    const canvas = page.getByLabel('Tela do emulador', { exact: true })
    await expect(canvas).toBeFocused()
    await expect(choice).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('MBC1', { exact: true })).toBeVisible()
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
      .toBeGreaterThan(5)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Pausar', exact: true }).click()
    await page.getByText('Controles e créditos dos jogos', { exact: true }).click()
    const library = page.getByRole('region', { name: 'Uma aventura já está à sua espera.' })
    await expect(library.getByRole('heading', { name: game.title, exact: true })).toBeVisible()
    await expect(library.getByRole('link', { name: new RegExp(game.author) })).toHaveAttribute(
      'href',
      game.sourceUrl,
    )
  })
}

test('recusa uma demo alterada e permite tentar novamente com os bytes originais', async ({
  page,
}) => {
  const game = DEMO_GAMES.find((entry) => entry.id === '2048')!
  await page.route(`**${game.romUrl}`, (route) =>
    route.fulfill({ status: 200, body: Buffer.alloc(32768) }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp(`^Jogar \\d{2} ${game.title}\\.`) }).click()
  await expect(page.getByRole('alert')).toContainText('está incompleto ou mudou')
  await expect(page.getByLabel('Tela do emulador', { exact: true })).toHaveCount(0)
  await page.unroute(`**${game.romUrl}`)
  await page.getByRole('button', { name: new RegExp(`^Jogar \\d{2} ${game.title}\\.`) }).click()
  await expect(page.getByLabel('Tela do emulador', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
