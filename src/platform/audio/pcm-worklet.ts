import { PcmStream } from './pcm-stream'
import { AUDIO_PROCESSOR_NAME, isAudioEpoch } from './protocol'
import type {
  AudioControlMessage,
  AudioNeedMessage,
  AudioSamplesMessage,
  AudioStatsMessage,
} from './protocol'

// Os tipos DOM não declaram o escopo de renderização de AudioWorklet.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare const sampleRate: number
declare function registerProcessor(name: string, processor: typeof PocketPcmProcessor): void

class PocketPcmProcessor extends AudioWorkletProcessor {
  private readonly stream = new PcmStream(sampleRate)
  private workerPort: MessagePort | null = null
  private disposed = false
  private reportFrames = 0

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<AudioControlMessage>) => {
      const message = event.data
      if (!message || this.disposed) return
      if (message.type === 'dispose') {
        this.disposed = true
        this.stream.reset(0, false)
        this.closeWorkerPort()
        this.port.close()
      } else if (message.type === 'connect' && isAudioEpoch(message.epoch)) {
        this.closeWorkerPort()
        this.stream.reset(message.epoch, false)
        this.workerPort = message.port
        this.workerPort.onmessage = (pcmEvent: MessageEvent<AudioSamplesMessage>) => {
          const data = pcmEvent.data
          if (data?.type === 'samples' && data.samples instanceof Float32Array) {
            if (this.stream.receive(data.samples, data.epoch) && data.samples.length > 0)
              this.requestSamples()
          }
        }
        this.workerPort.start()
        this.report()
      } else if (message.type === 'reset' && isAudioEpoch(message.epoch)) {
        this.stream.reset(message.epoch, message.active)
        this.reportFrames = 0
        this.requestSamples()
        this.report()
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false
    const output = outputs[0]
    const left = output?.[0]
    const right = output?.[1]
    if (!left || !right) return true
    this.stream.render(left, right)
    this.requestSamples()
    this.reportFrames += left.length
    if (this.reportFrames >= sampleRate / 4) {
      this.reportFrames = 0
      this.report()
    }
    return true
  }

  private requestSamples(): void {
    if (!this.workerPort) return
    const frames = this.stream.demand()
    if (frames === 0) return
    const message: AudioNeedMessage = {
      type: 'need',
      frames,
      epoch: this.stream.currentEpoch,
    }
    this.workerPort.postMessage(message)
  }

  private report(): void {
    const message: AudioStatsMessage = { type: 'stats', diagnostics: this.stream.diagnostics() }
    this.port.postMessage(message)
  }

  private closeWorkerPort(): void {
    if (!this.workerPort) return
    this.workerPort.onmessage = null
    this.workerPort.close()
    this.workerPort = null
  }
}

registerProcessor(AUDIO_PROCESSOR_NAME, PocketPcmProcessor)
