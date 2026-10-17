import { arch, cpus, platform, release, totalmem } from 'node:os'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import { AUDIO_MAX_FRAMES } from '../../src/platform/audio/protocol'
import { expectProductionClean, observeProduction, readProductionProbe } from './probe'

const WINDOW_MS = 30_000

type Observation = Awaited<ReturnType<typeof readProductionProbe>>

async function waitFrames(canvas: Locator, count: number): Promise<void> {
  const initial = Number(await canvas.getAttribute('data-frame-id'))
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(initial + count)
}

async function pressForFrames(page: Page, canvas: Locator, key: string, following: number) {
  await page.keyboard.down(key)
  await waitFrames(canvas, 3)
  await page.keyboard.up(key)
  await waitFrames(canvas, following)
}

function summarizeWindow(before: Observation, after: Observation, audioEnabled: boolean) {
  const start = before.workers.at(-1)!
  const end = after.workers.at(-1)!
  const elapsedSeconds = (after.observedAt - before.observedAt) / 1000
  const tCycles = end.totalTCycles - start.totalTCycles
  const frames = end.frameId - start.frameId
  const audio = after.latestAudio
  const audioBefore = before.latestAudio
  const samples = after.audioHistory.filter(
    (sample) =>
      sample.receivedAt >= before.observedAt &&
      sample.receivedAt <= after.observedAt &&
      sample.epoch === audio?.epoch,
  )
  const renderedFrames = (audio?.renderedFrames ?? 0) - (audioBefore?.renderedFrames ?? 0)
  const underrunFrames = (audio?.underrunFrames ?? 0) - (audioBefore?.underrunFrames ?? 0)
  return {
    audioEnabled,
    requestedWindowSeconds: WINDOW_MS / 1000,
    elapsedSeconds,
    tCycles,
    emulatedSeconds: tCycles / DMG_CLOCK_HZ,
    speedPercent: (tCycles / DMG_CLOCK_HZ / elapsedSeconds) * 100,
    frames,
    observedFramesPerSecond: frames / elapsedSeconds,
    workerSnapshots: end.snapshots - start.snapshots,
    audio: audioEnabled
      ? {
          contextState: after.contexts.at(-1)!.state,
          sampleRate: after.contexts.at(-1)!.sampleRate,
          epoch: audio!.epoch,
          observationCount: samples.length,
          renderedFrames,
          underrunFrames,
          underruns: audio!.underruns - audioBefore!.underruns,
          underrunPercent:
            renderedFrames + underrunFrames > 0
              ? (underrunFrames / (renderedFrames + underrunFrames)) * 100
              : 0,
          droppedFrames: audio!.droppedFrames - audioBefore!.droppedFrames,
          energy: audio!.energy - audioBefore!.energy,
          maximumObservedPeakLevel: Math.max(...samples.map((sample) => sample.peakLevel)),
          queueMinimumFrames: Math.min(...samples.map((sample) => sample.queuedFrames)),
          queueMaximumFrames: Math.max(...samples.map((sample) => sample.queuedFrames)),
          queueMeanFrames:
            samples.reduce((sum, sample) => sum + sample.queuedFrames, 0) / samples.length,
        }
      : null,
  }
}

test('mede 30 s sem som e 30 s com som em Tobu Tobu Girl em gameplay', async ({
  page,
  browser,
}, testInfo) => {
  const simulatedMobile = testInfo.project.name === 'mobile'
  const throttleRate = simulatedMobile ? 4 : 1
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttleRate })
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await observeProduction(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect
    .poll(async () => (await readProductionProbe(page)).firstUiAfterNavigationMs)
    .not.toBeNull()
  await page.getByRole('button', { name: /^Jogar 01 Tobu Tobu Girl\./ }).click()
  const canvas = page.getByLabel('Tela do emulador', { exact: true })
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame-id')))
    .toBeGreaterThan(0)
  const launch = await readProductionProbe(page)
  expect(launch.firstFrameAfterClickMs).not.toBeNull()

  // Mesma preparação verificada pelo teste de integração da ROM original:
  // logos/intro, título, escolha de fase e animação de entrada em gameplay.
  await waitFrames(canvas, 900)
  await pressForFrames(page, canvas, 'Enter', 90)
  await pressForFrames(page, canvas, 'Enter', 90)
  await pressForFrames(page, canvas, 'KeyZ', 150)
  await pressForFrames(page, canvas, 'ArrowRight', 2)
  const silentScreenshot = testInfo.outputPath('gameplay-sem-som.png')
  await canvas.screenshot({ path: silentScreenshot })
  await testInfo.attach('gameplay-sem-som', { path: silentScreenshot, contentType: 'image/png' })
  const noAudioBefore = await readProductionProbe(page)
  expect(noAudioBefore.contexts).toHaveLength(0)
  await page.waitForTimeout(WINDOW_MS)
  const noAudioAfter = await readProductionProbe(page)
  expect(noAudioAfter.contexts).toHaveLength(0)
  const silent = summarizeWindow(noAudioBefore, noAudioAfter, false)
  expect(silent.elapsedSeconds).toBeGreaterThanOrEqual(30)
  expect(silent.tCycles).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Ativar som', exact: true }).click()
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.energy ?? 0, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)
  await expect
    .poll(async () => (await readProductionProbe(page)).latestAudio?.renderedFrames ?? 0)
    .toBeGreaterThan(8192)
  const audioScreenshot = testInfo.outputPath('gameplay-com-som.png')
  await canvas.screenshot({ path: audioScreenshot })
  await testInfo.attach('gameplay-com-som', { path: audioScreenshot, contentType: 'image/png' })
  const audioBefore = await readProductionProbe(page)
  await page.waitForTimeout(WINDOW_MS)
  const audioAfter = await readProductionProbe(page)
  const sound = summarizeWindow(audioBefore, audioAfter, true)
  expect(sound.elapsedSeconds).toBeGreaterThanOrEqual(30)
  expect(sound.tCycles).toBeGreaterThan(0)
  expect(sound.audio!.contextState).toBe('running')
  expect(sound.audio!.epoch).toBe(audioBefore.latestAudio!.epoch)
  expect(sound.audio!.observationCount).toBeGreaterThan(0)
  expect(sound.audio!.energy).toBeGreaterThan(0)
  expect(sound.audio!.maximumObservedPeakLevel).toBeLessThanOrEqual(1)
  expect(sound.audio!.queueMaximumFrames).toBeLessThanOrEqual(AUDIO_MAX_FRAMES)
  await expectProductionClean(page)

  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    profile: simulatedMobile ? 'Pixel 7 simulado com CDP CPU 4x na página' : 'Desktop local',
    game: 'Tobu Tobu Girl, fase inicial com mortes e reinícios normais do jogo',
    browserVersion: browser.version(),
    viewport: page.viewportSize(),
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      deviceScaleFactor: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
    })),
    host: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpuModel: cpus()[0]?.model ?? 'indisponível',
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
    },
    launch: {
      firstUiAfterNavigationMs: launch.firstUiAfterNavigationMs,
      firstContentfulPaintMs: launch.firstContentfulPaintMs,
      firstFrameAfterClickMs: launch.firstFrameAfterClickMs,
    },
    windows: [silent, sound],
    limitations: [
      'Build de produção servida por loopback, sem compressão e com cache do navegador desativado.',
      'A primeira UI usa dois requestAnimationFrame após a montagem do h1; FCP vem da API Performance.',
      'O primeiro frame é o primeiro framebuffer da ROM apresentado no Canvas, não o início da fase.',
      'A velocidade usa T-cycles reais recebidos do Worker divididos pelo tempo de parede observado.',
      'Wrappers nativos observam mensagens sem substituir CPU, PCM ou comandos da aplicação.',
      'A preparação usa eventos de teclado e o jogo normal, sem replay determinístico entre perfis.',
      'CDP 4x é relativo ao host e aplicado à página; não comprova throttling do Worker nem um Pixel 7 físico.',
      'A fila de áudio é amostrada pelos relatórios do Worklet, aproximadamente a cada 250 ms.',
      'Energia PCM é medida antes do ganho; não mede saída física, latência de alto-falante, bateria ou gamepad físico.',
    ],
  }
  const reportPath = testInfo.outputPath('browser-benchmark.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  await testInfo.attach('browser-benchmark.json', {
    path: reportPath,
    contentType: 'application/json',
  })
  console.log(JSON.stringify(report))
})
