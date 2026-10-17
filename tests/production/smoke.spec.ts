import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { AUDIO_MAX_FRAMES } from '../../src/platform/audio/protocol'
import { DEMO_GAMES } from '../../src/platform/games/catalog'
import { decodeState } from '../../src/platform/states'
import { expectProductionClean, observeProduction, readProductionProbe } from './probe'

test.beforeEach(async ({ page }) => observeProduction(page))
test.afterEach(async ({ page }) => expectProductionClean(page))

async function image(canvas: Locator): Promise<string> {
  return canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
}

async function openGarden(page: Page): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(3)
  return canvas
}

test('serve somente build estática com CSP e headers de produção', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  const headers = response!.headers()
  expect(headers['content-security-policy']).toContain("script-src 'self'")
  expect(headers['content-security-policy']).toContain("worker-src 'self'")
  expect(headers['content-security-policy']).toContain("connect-src 'self'")
  expect(headers['content-security-policy']).not.toContain('unsafe-eval')
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['cross-origin-resource-policy']).toBe('same-origin')
  expect(headers['permissions-policy']).toContain('camera=()')
  expect(headers['permissions-policy']).toContain('microphone=()')
  expect(headers['cache-control']).toContain('must-revalidate')
  const html = await response!.text()
  expect(html).not.toMatch(/@vite\/client|\/src\/main\.tsx/)
  const scripts = await page
    .locator('script[src]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('src')))
  expect(scripts.length).toBeGreaterThan(0)
  for (const source of scripts) expect(source).toMatch(/^\/assets\/.+-[\w-]+\.js$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('abre os dois homebrews com bytes autorizados e CPU executando no Worker da build', async ({
  page,
}) => {
  await page.goto('/')
  for (const game of DEMO_GAMES) {
    const responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === game.romUrl,
    )
    await page.getByRole('button', { name: new RegExp(`^Jogar \\d{2} ${game.title}\\.`) }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    expect(
      createHash('sha256')
        .update(await response.body())
        .digest('hex'),
    ).toBe(game.sha256)
    const canvas = page.getByLabel('Tela do emulador', { exact: true })
    await expect
      .poll(async () => {
        const probe = await readProductionProbe(page)
        const worker = probe.workers.at(-1)
        return worker?.romId === game.sha256 ? worker.frameId : 0
      })
      .toBeGreaterThan(3)
    await expect(canvas).toBeFocused()
    const probe = await readProductionProbe(page)
    const worker = probe.workers.at(-1)!
    expect(worker.url).toMatch(/\/assets\/emulator\.worker-[\w-]+\.js$/)
    expect(worker.totalTCycles).toBeGreaterThan(70_224)
    expect(worker.playing).toBe(true)
    expect(probe.workers.filter((item) => !item.terminated)).toHaveLength(1)
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
})

test('reproduz PCM real no AudioWorklet sem erros da CSP, e pausa limpa a fila', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Jogar 01 Tobu Tobu Girl\./ }).click()
  await expect(page.getByLabel('Tela do emulador', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Silenciar', exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.energy ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  const probe = await readProductionProbe(page)
  expect(probe.contexts).toHaveLength(1)
  expect(probe.nodeCount).toBe(1)
  expect(probe.contexts[0]!.state).toBe('running')
  expect(probe.latestAudio!.renderedFrames).toBeGreaterThan(8192)
  expect(probe.latestAudio!.queuedFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
  await page.getByLabel('Volume', { exact: true }).fill('25')
  await expect.poll(async () => (await readProductionProbe(page)).gain).toBe(0.25)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect
    .poll(async () => (await readProductionProbe(page)).contexts[0]!.state)
    .toBe('suspended')
  await expect.poll(async () => (await readProductionProbe(page)).latestAudio?.queuedFrames).toBe(0)
  await expect(page.getByRole('status', { name: 'Estado do áudio' })).toHaveCount(0)
})

test('slots, reload e arquivos locais restauram a mesma tela e CPU na build final', async ({
  page,
}) => {
  const canvas = await openGarden(page)
  const notice = page.getByRole('status', { name: 'Estado dos slots', exact: true })
  await page.getByRole('button', { name: 'Salvar estado', exact: true }).click()
  await expect(notice).toContainText('Estado salvo no slot 1')
  const savedImage = await image(canvas)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  const savedCycles = String((await readProductionProbe(page)).workers.at(-1)!.totalTCycles)
  await expect(page.getByLabel('T-cycles executados', { exact: true })).toHaveText(savedCycles)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar estado', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pocketstate$/)
  const path = await download.path()
  if (!path) throw new Error('O arquivo exportado não foi disponibilizado pelo navegador.')
  const bytes = await readFile(path)
  const record = await decodeState(bytes)
  expect(
    (record.payload as { core: { cpu: { totalTCycles: number } } }).core.cpu.totalTCycles,
  ).toBe(Number(savedCycles))
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await page.keyboard.down('ArrowRight')
  await expect.poll(() => image(canvas)).not.toBe(savedImage)
  await page.keyboard.up('ArrowRight')
  await page.getByRole('button', { name: 'Carregar estado', exact: true }).click()
  await expect(notice).toContainText('Slot 1 carregado')
  await expect.poll(() => image(canvas)).toBe(savedImage)
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Carregar estado', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Carregar estado', exact: true }).click()
  await expect(notice).toContainText('Slot 1 carregado')
  await expect.poll(() => image(canvas)).toBe(savedImage)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect(page.getByLabel('T-cycles executados', { exact: true })).toHaveText(savedCycles)
  await page.getByRole('radio', { name: 'Slot 3', exact: true }).check()
  await page.getByLabel('Arquivo de estado', { exact: true }).setInputFiles({
    name: 'backup.pocketstate',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  })
  await expect(notice).toContainText('Arquivo importado no slot 3')
  await expect.poll(() => image(canvas)).toBe(savedImage)
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await expect(page.getByLabel('T-cycles executados', { exact: true })).toHaveText(savedCycles)
})

test('remapeamento persistente e tela cheia nativa funcionam no artefato estático', async ({
  page,
}) => {
  await openGarden(page)
  await page.getByText('Controles e preferências', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible()
  const field = page.getByLabel('Tecla para Botão A', { exact: true })
  await field.press('KeyC')
  await expect(field).toHaveValue('C')
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await page.keyboard.down('KeyC')
  await expect(page.getByRole('button', { name: 'Botão A', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.up('KeyC')
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('jogar')
  await page.getByRole('button', { name: 'Sair da tela cheia', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await page.reload()
  await page.getByText('Controles e preferências', { exact: true }).click()
  await expect(field).toHaveValue('C')
})
