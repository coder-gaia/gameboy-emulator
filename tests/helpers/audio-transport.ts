import type { Page } from '@playwright/test'

interface AudioTransportRequest {
  readonly sequence: number
  readonly epoch: number
  readonly frames: number
  readonly receivedAt: number
  forwardedAt: number | null
  responseReceivedAt: number | null
  responseForwardedAt: number | null
  responseFrames: number | null
}

interface AudioTransportObservation {
  readonly delayPerDirectionMs: number
  bridgesCreated: number
  bridgesClosed: number
  requestsForwarded: number
  samplesForwarded: number
  maximumRequestFrames: number
  maximumResponseFrames: number
  readonly requests: AudioTransportRequest[]
}

type ObservedWindow = Window &
  typeof globalThis & { __audioTransportObservation: AudioTransportObservation }

/** Insere dois saltos e um atraso por sentido no transporte PCM real da aplicação. */
export async function delayAudioTransport(page: Page, delayPerDirectionMs: number): Promise<void> {
  if (!Number.isFinite(delayPerDirectionMs) || delayPerDirectionMs < 0)
    throw new RangeError('O atraso de áudio deve ser finito e não negativo.')

  await page.addInitScript(
    ({ delayPerDirectionMs }) => {
      interface Bridge {
        readonly workerSide: MessagePort
        readonly workletSide: MessagePort
        readonly timers: Set<number>
        pending: AudioTransportRequest | null
      }
      const observation: AudioTransportObservation = {
        delayPerDirectionMs,
        bridgesCreated: 0,
        bridgesClosed: 0,
        requestsForwarded: 0,
        samplesForwarded: 0,
        maximumRequestFrames: 0,
        maximumResponseFrames: 0,
        requests: [],
      }
      ;(window as ObservedWindow).__audioTransportObservation = observation
      const bridges = new WeakMap<Worker, Bridge>()
      const nativePost = Worker.prototype.postMessage
      const nativeTerminate = Worker.prototype.terminate
      let sequence = 0

      function observeRequest(data: unknown): AudioTransportRequest | null {
        const request = data as { type?: string; frames?: number; epoch?: number }
        if (request?.type !== 'need' || typeof request.frames !== 'number') return null
        sequence += 1
        const observationEntry: AudioTransportRequest = {
          sequence,
          epoch: request.epoch ?? -1,
          frames: request.frames,
          receivedAt: performance.now(),
          forwardedAt: null,
          responseReceivedAt: null,
          responseForwardedAt: null,
          responseFrames: null,
        }
        observation.requests[(sequence - 1) % 1024] = observationEntry
        return observationEntry
      }

      function closeBridge(worker: Worker): void {
        const bridge = bridges.get(worker)
        if (!bridge) return
        for (const timer of bridge.timers) window.clearTimeout(timer)
        bridge.timers.clear()
        bridge.workerSide.onmessage = null
        bridge.workletSide.onmessage = null
        bridge.workerSide.close()
        bridge.workletSide.close()
        bridges.delete(worker)
        observation.bridgesClosed += 1
      }

      function later(bridge: Bridge, callback: () => void): void {
        const timer = window.setTimeout(() => {
          bridge.timers.delete(timer)
          callback()
        }, delayPerDirectionMs)
        bridge.timers.add(timer)
      }

      Worker.prototype.postMessage = function (
        this: Worker,
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        if (message === null || typeof message !== 'object') {
          Reflect.apply(nativePost, this, [message, transferOrOptions])
          return
        }
        const envelope = message as Record<string, unknown>
        const command = envelope.command as Record<string, unknown> | undefined
        if (command?.type === 'audio-disable' || command?.type === 'init') closeBridge(this)
        if (command?.type !== 'audio-port' || !(command.port instanceof MessagePort)) {
          Reflect.apply(nativePost, this, [message, transferOrOptions])
          return
        }

        closeBridge(this)
        const originalPort = command.port
        const channel = new MessageChannel()
        const bridge: Bridge = {
          workerSide: channel.port2,
          workletSide: originalPort,
          timers: new Set(),
          pending: null,
        }
        bridges.set(this, bridge)
        observation.bridgesCreated += 1
        originalPort.onmessage = ({ data }: MessageEvent<unknown>) => {
          const requestObservation = observeRequest(data)
          bridge.pending = requestObservation
          later(bridge, () => {
            const request = data as { type?: string; frames?: number }
            if (request?.type === 'need' && typeof request.frames === 'number') {
              observation.requestsForwarded += 1
              observation.maximumRequestFrames = Math.max(
                observation.maximumRequestFrames,
                request.frames,
              )
              if (requestObservation) requestObservation.forwardedAt = performance.now()
            }
            channel.port2.postMessage(data)
          })
        }
        channel.port2.onmessage = ({ data }: MessageEvent<unknown>) => {
          const requestObservation = bridge.pending
          bridge.pending = null
          if (requestObservation) requestObservation.responseReceivedAt = performance.now()
          later(bridge, () => {
            const response = data as { type?: string; samples?: Float32Array }
            const samples = response?.samples
            if (response?.type === 'samples' && samples instanceof Float32Array) {
              observation.samplesForwarded += 1
              observation.maximumResponseFrames = Math.max(
                observation.maximumResponseFrames,
                samples.length / 2,
              )
              if (requestObservation) {
                requestObservation.responseForwardedAt = performance.now()
                requestObservation.responseFrames = samples.length / 2
              }
              originalPort.postMessage(data, [samples.buffer])
            } else originalPort.postMessage(data)
          })
        }
        originalPort.start()
        channel.port2.start()

        const transfer = Array.isArray(transferOrOptions)
          ? transferOrOptions
          : (transferOrOptions?.transfer ?? [])
        const replacedTransfer = transfer.map((item) =>
          item === originalPort ? channel.port1 : item,
        )
        const replacedMessage = {
          ...envelope,
          command: { ...command, port: channel.port1 },
        }
        const replacedOptions = Array.isArray(transferOrOptions)
          ? replacedTransfer
          : { ...transferOrOptions, transfer: replacedTransfer }
        Reflect.apply(nativePost, this, [replacedMessage, replacedOptions])
      }

      Worker.prototype.terminate = function (this: Worker): void {
        closeBridge(this)
        Reflect.apply(nativeTerminate, this, [])
      }
    },
    { delayPerDirectionMs },
  )
}

export async function readAudioTransport(page: Page): Promise<AudioTransportObservation> {
  return page.evaluate(() => {
    const observation = (window as ObservedWindow).__audioTransportObservation
    return {
      ...observation,
      requests: [...observation.requests].sort((first, second) => first.sequence - second.sequence),
    }
  })
}
