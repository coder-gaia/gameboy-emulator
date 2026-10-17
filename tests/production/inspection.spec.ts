import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectProductionClean, observeProduction } from './probe'

test('painéis de inspeção e diagnóstico local funcionam na build sob CSP', async ({ page }) => {
  await observeProduction(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar jardim', exact: true }).click()
  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.getByText('Painel técnico', { exact: true }).click()
  await expect(page.getByRole('region', { name: 'Desassemblador', exact: true })).toBeVisible()
  await expect(
    page.getByRole('img', { name: '384 tiles da VRAM em 16 colunas e 24 linhas', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Tabela OAM', exact: true }).locator('tbody tr'),
  ).toHaveCount(40)
  await expect(page.getByRole('region', { name: 'Conteúdo da memória', exact: true })).toBeVisible()
  await page.getByText('Painel técnico', { exact: true }).click()
  await page.getByText('Inspecionar CPU', { exact: true }).click()
  await page.getByText('Desempenho e áudio', { exact: true }).click()
  await expect(page.getByLabel('Taxa de áudio', { exact: true })).toContainText('Hz')
  await expect(
    page.getByRole('button', { name: 'Medir por 60 segundos', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Medir por 60 segundos', exact: true }).click()
  await page.waitForTimeout(1300)
  await page.getByRole('button', { name: 'Encerrar medição', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar diagnóstico', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('pocket-lab-diagnostico.json')
  const report = JSON.parse(await readFile((await download.path())!, 'utf8')) as Record<
    string,
    unknown
  >
  expect(report.version).toBe(1)
  expect(report).not.toHaveProperty('rom')
  expect(report).not.toHaveProperty('memory')
  await expectProductionClean(page)
})
