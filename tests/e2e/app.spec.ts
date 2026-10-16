import { expect, test } from '@playwright/test'
import { buildTestRom } from '../fixtures/rom'

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

test('lê um cartucho local e apresenta o header real', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'test.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(buildTestRom({ title: 'POCKET TEST' })),
  })
  await expect(page.getByRole('heading', { name: 'POCKET TEST', exact: true })).toBeVisible()
  await expect(page.getByText('ROM Only', { exact: true })).toBeVisible()
  await expect(page.getByText('32 KiB', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Trocar cartucho/ })).toBeEnabled()
})

test('recusa um arquivo truncado com uma mensagem útil', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'broken.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(16),
  })
  await expect(page.getByRole('alert')).toContainText('pelo menos 32 KiB')
  await expect(page.getByRole('button', { name: /Carregar cartucho/ })).toBeEnabled()
})

test('inspeciona mapper futuro sem prometer execução', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'mbc1.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(buildTestRom({ title: 'MBC1 TEST', cartridgeType: 1, romSizeCode: 1 })),
  })
  await expect(page.getByRole('heading', { name: 'MBC1 TEST', exact: true })).toBeVisible()
  await expect(
    page.getByText('O controlador MBC1 ainda não é executado.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Inspecionar CPU', { exact: true })).toHaveCount(0)
})

test('aceita um cartucho arrastado para a página', async ({ page }) => {
  await page.goto('/')
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer()
      data.items.add(
        new File([new Uint8Array(bytes)], 'drop.gb', { type: 'application/octet-stream' }),
      )
      return data
    },
    Array.from(buildTestRom({ title: 'DROP TEST' })),
  )
  await page.locator('main').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.getByRole('heading', { name: 'DROP TEST', exact: true })).toBeVisible()
  await transfer.dispose()
})

test('executa e reinicia o diagnóstico da CPU sem arquivo externo', async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Experimentar cartucho de diagnóstico', exact: true })
    .click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('0100')
  await page.getByRole('button', { name: 'Uma instrução', exact: true }).click()
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('0150')
  await page.getByRole('button', { name: 'Até 1000 instruções', exact: true }).click()
  await expect(page.getByLabel('Estado da CPU', { exact: true })).toHaveText('HALT')
  await expect(page.getByLabel('Saída serial', { exact: true })).toHaveText('OK')
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('017D')
  await page.getByRole('button', { name: 'Reiniciar CPU', exact: true }).click()
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('0100')
  await expect(page.getByLabel('T-cycles executados', { exact: true })).toHaveText('0')
  await expect(page.getByLabel('Saída serial', { exact: true })).toHaveText('Aguardando saída...')
})

test('interrompe opcode inválido e permite reiniciar a inspeção', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Arquivo do cartucho', { exact: true }).setInputFiles({
    name: 'invalid-opcode.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(buildTestRom({ program: [0xd3] })),
  })
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.getByRole('button', { name: 'Até 1000 instruções', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('0xD3')
  await expect(page.getByLabel('Estado da CPU', { exact: true })).toHaveText('Interrompida')
  await page.getByRole('button', { name: 'Reiniciar CPU', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByLabel('Registrador PC', { exact: true })).toHaveText('0100')
})

test('desenha vídeo real, pausa sem avançar e retoma o jardim', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect(canvas).toBeVisible()
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(2)
  const shades = await canvas.evaluate((element) => {
    const pixels = (element as HTMLCanvasElement)
      .getContext('2d')!
      .getImageData(0, 0, 160, 144).data
    const colors = new Set<string>()
    for (let index = 0; index < pixels.length; index += 4)
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`)
    return colors.size
  })
  expect(shades).toBe(4)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  const stopped = await canvas.getAttribute('data-frame-id')
  await page.waitForTimeout(150)
  expect(await canvas.getAttribute('data-frame-id')).toBe(stopped)
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(Number(stopped))
})

test('troca a paleta do Canvas e reinicia a máquina', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(2)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await page.getByRole('button', { name: 'Pocket', exact: true }).click()
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const pixels = (element as HTMLCanvasElement)
          .getContext('2d')!
          .getImageData(0, 0, 1, 1).data
        return Array.from(pixels).slice(0, 3)
      }),
    )
    .toEqual([213, 213, 201])
  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-frame-id', '0')
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
})
