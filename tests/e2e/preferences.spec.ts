import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function garden(page: Page) {
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
}

test('preferências persistem, teclado pode ser remapeado e conflitos não alteram os comandos', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await garden(page)
  await page.getByLabel('Volume', { exact: true }).fill('23')
  await page.getByText('Controles e preferências', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  const action = page.getByLabel('Tecla para Botão A', { exact: true })
  await action.press('KeyX')
  await expect(page.getByRole('status', { name: 'Configuração do teclado' })).toContainText(
    'mesma tecla',
  )
  await expect(action).toHaveValue('Z')
  await action.press('KeyC')
  await expect(action).toHaveValue('C')
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  const buttonA = page.getByRole('button', { name: 'Botão A', exact: true })
  await page.keyboard.down('KeyC')
  await expect(buttonA).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.up('KeyC')
  await page.keyboard.down('KeyZ')
  await expect(buttonA).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.up('KeyZ')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await garden(page)
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('23')
  await page.getByText('Controles e preferências', { exact: true }).click()
  await expect(action).toHaveValue('C')
  await page.getByRole('button', { name: 'Restaurar teclado padrão', exact: true }).click()
  await expect(action).toHaveValue('Z')
})

test('preferências bloqueadas mantêm a aplicação e os ajustes da sessão utilizáveis', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Bloqueado no teste', 'SecurityError')
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Pocket', exact: true }).click()
  await page.getByText('Controles e preferências', { exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado das preferências' })).toContainText(
    'funcionam nesta sessão',
  )
  await expect(page.getByRole('button', { name: 'Pocket', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await garden(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('controle padrão convive com teclado e libera entradas ao desconectar', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as Window & {
      testPad?: { connected: boolean; right: boolean; action: boolean }
    }
    probe.testPad = { connected: false, right: false, action: false }
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        const current = probe.testPad!
        if (!current.connected) return []
        return [
          {
            id: 'Controle padrão de teste',
            index: 0,
            connected: true,
            mapping: 'standard',
            axes: [current.right ? 0.8 : 0, 0],
            buttons: Array.from({ length: 17 }, (_, index) => ({
              pressed: index === 0 && current.action,
              touched: false,
              value: index === 0 && current.action ? 1 : 0,
            })),
          },
        ]
      },
    })
  })
  await page.goto('/')
  await garden(page)
  const right = page.getByRole('button', { name: 'Direita', exact: true })
  const action = page.getByRole('button', { name: 'Botão A', exact: true })
  await page.evaluate(() => {
    Object.assign((window as Window & { testPad?: object }).testPad!, {
      connected: true,
      right: true,
      action: true,
    })
  })
  await expect(right).toHaveAttribute('aria-pressed', 'true')
  await expect(action).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.down('ArrowRight')
  await page.evaluate(() => {
    Object.assign((window as Window & { testPad?: object }).testPad!, {
      connected: false,
      right: false,
      action: false,
    })
  })
  await expect(action).toHaveAttribute('aria-pressed', 'false')
  await expect(right).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.up('ArrowRight')
  await expect(right).toHaveAttribute('aria-pressed', 'false')
  await page.getByText('Controles e preferências', { exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado do gamepad' })).toContainText(
    'Conecte um controle',
  )
})

test('tela cheia nativa mantém o jogo e retorna ao layout da página', async ({ page }) => {
  await page.goto('/')
  await garden(page)
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('jogar')
  await expect(page.getByRole('button', { name: 'Sair da tela cheia', exact: true })).toBeVisible()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  const frame = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(frame + 3)
  await page.getByRole('button', { name: 'Sair da tela cheia', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(
    page.getByRole('heading', { name: 'Uma pequena pausa. Um mundo inteiro.' }),
  ).toBeVisible()
})

test('ausência de tela cheia mostra uma mensagem e mantém a reprodução', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
  })
  await page.goto('/')
  await garden(page)
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Estado da tela cheia' })).toContainText(
    'não está disponível',
  )
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
})
