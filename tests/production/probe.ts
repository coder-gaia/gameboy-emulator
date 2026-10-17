import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { AudioStreamDiagnostics } from '../../src/platform/audio/protocol'
import type { EmulatorMessage } from '../../src/runtime/worker-protocol'

interface WorkerObservation {
  url: string
  terminated: boolean
  snapshots: number
  frameId: number
  totalTCycles: number
  romId: string
  playing: boolean
  receivedAt: number
  rewind: BrowserRewindState | null
  rewindRestores: number
  minimumRewindTCycles: number | null
  batteryFirstByte: number | null
}

export interface BrowserRewindState {
  enabled: boolean
  active: boolean
  entries: number
  availableSeconds: number
  allocatedBytes: number
  usedBytes: number
  maxSeconds: number
  maxBytes: number
}

interface AudioObservation extends AudioStreamDiagnostics {
  receivedAt: number
}

interface ProductionProbe {
  workers: WorkerObservation[]
  contexts: AudioContext[]
  nodes: AudioWorkletNode[]
  gains: GainNode[]
  audio: AudioObservation[]
  csp: { directive: string; blocked: string }[]
  selectionStartedAt: number | null
  firstPresentedAt: number | null
  firstUiPresentedAt: number | null
}

type ProbedWindow = Window & typeof globalThis & { __productionProbe: ProductionProbe }

interface PageAudit {
  requests: string[]
  errors: string[]
}

const audits = new WeakMap<Page, PageAudit>()

/** Observa as APIs nativas; nenhum frame, PCM ou comando da aplicação é substituído. */
export async function observeProduction(page: Page): Promise<void> {
  const audit: PageAudit = { requests: [], errors: [] }
  audits.set(page, audit)
  page.context().on('request', (request) => audit.requests.push(request.url()))
  page.on('pageerror', (error) => audit.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') audit.errors.push(message.text())
  })
  await page.addInitScript(() => {
    const probe: ProductionProbe = {
      workers: [],
      contexts: [],
      nodes: [],
      gains: [],
      audio: [],
      csp: [],
      selectionStartedAt: null,
      firstPresentedAt: null,
      firstUiPresentedAt: null,
    }
    ;(window as ProbedWindow).__productionProbe = probe
    document.addEventListener('securitypolicyviolation', (event) => {
      probe.csp.push({ directive: event.violatedDirective, blocked: event.blockedURI })
    })
    document.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element | null)?.closest('button')
        if (button?.getAttribute('aria-label')?.startsWith('Jogar ')) {
          probe.selectionStartedAt = performance.now()
          probe.firstPresentedAt = null
        }
      },
      true,
    )
    new MutationObserver(() => {
      if (probe.selectionStartedAt === null || probe.firstPresentedAt !== null) return
      const frame = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="Tela do emulador"]',
      )
      if (frame && Number(frame.dataset.frameId) > 0) probe.firstPresentedAt = performance.now()
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-frame-id'] })
    const uiObserver = new MutationObserver(() => {
      if (!document.querySelector('h1')) return
      uiObserver.disconnect()
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          probe.firstUiPresentedAt = performance.now()
        })
      })
    })
    uiObserver.observe(document, { subtree: true, childList: true })

    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      private readonly observation: WorkerObservation

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.observation = {
          url: String(url),
          terminated: false,
          snapshots: 0,
          frameId: 0,
          totalTCycles: 0,
          romId: '',
          playing: false,
          receivedAt: performance.now(),
          rewind: null,
          rewindRestores: 0,
          minimumRewindTCycles: null,
          batteryFirstByte: null,
        }
        probe.workers.push(this.observation)
        this.addEventListener('message', ({ data }: MessageEvent<EmulatorMessage>) => {
          if (data.type === 'error' || !data.snapshot) return
          const rewind = (data.snapshot as typeof data.snapshot & { rewind?: BrowserRewindState })
            .rewind
          if (
            data.snapshot.cpu.totalTCycles < this.observation.totalTCycles &&
            (rewind?.active || this.observation.rewind?.active)
          ) {
            this.observation.rewindRestores += 1
            this.observation.minimumRewindTCycles = Math.min(
              this.observation.minimumRewindTCycles ?? Number.POSITIVE_INFINITY,
              data.snapshot.cpu.totalTCycles,
            )
          }
          Object.assign(this.observation, {
            snapshots: this.observation.snapshots + 1,
            frameId: data.snapshot.frameId,
            totalTCycles: data.snapshot.cpu.totalTCycles,
            romId: data.snapshot.romId,
            playing: data.snapshot.playing,
            receivedAt: performance.now(),
            rewind: rewind ? { ...rewind } : null,
            batteryFirstByte: data.snapshot.batteryRam?.[0] ?? this.observation.batteryFirstByte,
          })
        })
      }

      override terminate(): void {
        this.observation.terminated = true
        super.terminate()
      }
    }
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options)
        probe.contexts.push(this)
      }

      override createGain(): GainNode {
        const gain = super.createGain()
        probe.gains.push(gain)
        return gain
      }
    }
    const NativeNode = window.AudioWorkletNode
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options)
        probe.nodes.push(this)
        this.port.addEventListener('message', ({ data }) => {
          if (data?.type === 'stats')
            probe.audio.push({ ...data.diagnostics, receivedAt: performance.now() })
        })
        this.port.start()
      }
    }
  })
}

export async function readProductionProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ProbedWindow).__productionProbe
    return {
      observedAt: performance.now(),
      workers: probe.workers.map((worker) => ({ ...worker })),
      contexts: probe.contexts.map((context) => ({
        state: context.state,
        sampleRate: context.sampleRate,
      })),
      nodeCount: probe.nodes.length,
      gain: probe.gains.at(-1)?.gain.value ?? 0,
      latestAudio: probe.audio.at(-1) ?? null,
      audioHistory: probe.audio.map((sample) => ({ ...sample })),
      csp: probe.csp,
      firstFrameAfterClickMs:
        probe.selectionStartedAt !== null && probe.firstPresentedAt !== null
          ? probe.firstPresentedAt - probe.selectionStartedAt
          : null,
      firstUiAfterNavigationMs: probe.firstUiPresentedAt,
      firstContentfulPaintMs:
        performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    }
  })
}

export async function expectProductionClean(page: Page): Promise<void> {
  const audit = audits.get(page)
  if (!audit) throw new Error('A observação da página de produção não foi iniciada.')
  const origin = new URL(page.url()).origin
  const external = audit.requests.filter((url) => {
    const parsed = new URL(url)
    return !['blob:', 'data:'].includes(parsed.protocol) && parsed.origin !== origin
  })
  expect(external, 'Toda requisição da aplicação deve permanecer na mesma origem.').toEqual([])
  expect(audit.errors, 'A build não deve produzir erros no navegador.').toEqual([])
  expect((await readProductionProbe(page)).csp, 'Nenhuma política CSP pode ser violada.').toEqual(
    [],
  )
}
