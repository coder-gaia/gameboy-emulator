import { PcmStream } from './pcm-stream'
import { AUDIO_PROCESSOR_NAME, isAudioEpoch } from './protocol'
import type {
  AudioControlMessage,
  AudioNeedMessage,
  AudioPlaybackMessage,
  AudioSamplesMessage,
  AudioStatsMessage,
} from './protocol'

// Os tipos DOM não declaram o escopo de renderização de AudioWorklet.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare const sampleRate: number
declare const currentTime: number
declare function registerProcessor(name: string, processor: typeof PocketPcmProcessor): void

class PocketPcmProcessor extends AudioWorkletProcessor {
  private readonly stream = new PcmStream(sampleRate)
  private workerPort: MessagePort | null = null
  private disposed = false
  private reportFrames = 0
  private playbackReportFrames = 0
  private playbackContextTime = currentTime

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
        this.resetPlaybackClock()
        this.workerPort = message.port
        this.workerPort.onmessage = (pcmEvent: MessageEvent<AudioSamplesMessage>) => {
          const data = pcmEvent.data
          if (data?.type === 'samples' && data.samples instanceof Float32Array) {
            if (this.stream.receive(data.samples, data.epoch)) {
              if (data.samples.length > 0) this.requestSamples()
              this.reportPlayback()
            }
          }
        }
        this.workerPort.start()
        this.reportPlayback()
        this.report()
      } else if (message.type === 'reset' && isAudioEpoch(message.epoch)) {
        this.stream.reset(message.epoch, message.active)
        this.reportFrames = 0
        this.resetPlaybackClock()
        this.requestSamples()
        this.reportPlayback()
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
    const wasAdvancing = this.stream.playbackAdvancing
    this.stream.render(left, right)
    this.playbackContextTime = currentTime + left.length / sampleRate
    this.requestSamples()
    this.playbackReportFrames += left.length
    if (this.playbackReportFrames >= 512 || wasAdvancing !== this.stream.playbackAdvancing)
      this.reportPlayback()
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

  private reportPlayback(): void {
    this.playbackReportFrames = 0
    const message: AudioPlaybackMessage = {
      type: 'playback',
      epoch: this.stream.currentEpoch,
      frame: this.stream.playbackFrame,
      availableFrame: this.stream.availablePlaybackFrame,
      contextTime: this.playbackContextTime,
      advancing: this.stream.playbackAdvancing,
    }
    this.port.postMessage(message)
  }

  private resetPlaybackClock(): void {
    this.playbackReportFrames = 0
    this.playbackContextTime = currentTime
  }

  private closeWorkerPort(): void {
    if (!this.workerPort) return
    this.workerPort.onmessage = null
    this.workerPort.close()
    this.workerPort = null
  }
}

registerProcessor(AUDIO_PROCESSOR_NAME, PocketPcmProcessor)
