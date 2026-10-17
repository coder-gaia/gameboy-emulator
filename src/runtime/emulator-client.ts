import type { JoypadButton } from '../core/joypad'
import type { AudioOutput } from '../platform/audio'
import type { CartridgeRtcState } from '../core/cartridge'
import type { HardwareDebugSnapshot } from '../core/debug'
import type {
  EmulatorCommand,
  EmulatorMessage,
  EmulatorSnapshot,
  EmulatorReplyPayload,
  MachineCheckpoint,
  RewindStatus,
  EmulatorVideoFrame,
} from './worker-protocol'
import { VideoPresentation } from './video-presentation'

const audioOwners = new WeakMap<AudioOutput, EmulatorClient>()
let clientSequence = 0

interface PendingRequest {
  resolve: (reply: EmulatorReplyPayload) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/** A interface só mantém uma cópia de apresentação; toda instrução roda no Worker. */
export class EmulatorClient {
  readonly instanceId = ++clientSequence
  private readonly worker: Worker
  private readonly listeners = new Set<() => void>()
  private readonly rewindListeners = new Set<() => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly pending = new Map<number, PendingRequest>()
  private sequence = 0
  private disposed = false
  private current!: EmulatorSnapshot
  private battery: Uint8Array | null = null
  private rtc: CartridgeRtcState | null = null
  private drawnFrameId: number | null = null
  private drawnFrameCount = 0
  private output: AudioOutput | null = null
  private readonly displayed = new Uint8Array(160 * 144)
  private displayedFrameId = 0
  private displayRevision = 0
  private readonly video = new VideoPresentation((frame) => this.recycleVideo(frame))

  private constructor() {
    if (typeof Worker === 'undefined')
      throw new Error('Seu navegador não disponibilizou a execução do emulador.')
    this.worker = new Worker(new URL('./emulator.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = ({ data }: MessageEvent<EmulatorMessage>) => {
      if (data.type === 'error') {
        this.reportError(new Error(data.error))
        return
      }
      if (data.type === 'video-frame') {
        if (this.current?.audioDriven && this.current.playing) this.video.push(data.frame)
        else this.recycleVideo(data.frame)
        return
      }
      if (data.type === 'frame') {
        this.update(data.snapshot)
        return
      }
      const pending = this.pending.get(data.id)
      if (!pending) return
      this.pending.delete(data.id)
      clearTimeout(pending.timeout)
      if (data.error) pending.reject(new Error(data.error))
      else {
        if (data.snapshot) this.update(data.snapshot)
        pending.resolve({ checkpoint: data.checkpoint, hardware: data.hardware })
      }
    }
    this.worker.onerror = () =>
      this.reportError(
        new Error('A execução do emulador foi interrompida. Tente reiniciar o cartucho.'),
      )
  }

  static async create(rom: Uint8Array): Promise<EmulatorClient> {
    const client = new EmulatorClient()
    try {
      const copy = rom.slice()
      await client.request({ type: 'init', rom: copy }, [copy.buffer])
      return client
    } catch (cause) {
      client.dispose()
      throw cause
    }
  }

  get framebuffer(): Uint8Array {
    return this.displayed
  }
  get frameId(): number {
    return this.displayedFrameId
  }
  get presentationRevision(): number {
    return this.displayRevision
  }
  get inspection(): EmulatorSnapshot {
    return this.current
  }
  get batteryRevision(): number {
    return this.current.batteryRevision
  }

  get romId(): string {
    return this.current.romId
  }

  get drawnFrames(): number {
    return this.drawnFrameCount
  }

  /** Conta imagens distintas enviadas ao Canvas, sem afirmar FPS físico do monitor. */
  noteFrameDrawn(revision: number): void {
    if (this.disposed || revision === this.drawnFrameId) return
    this.drawnFrameId = revision
    this.drawnFrameCount += 1
  }

  /** Chamado pelo RAF; o relógio é o do PCM consumido, sem antecipar quadros futuros. */
  presentAudioFrame(): void {
    if (this.disposed || !this.current.audioDriven || !this.current.playing) return
    const position = this.output?.getPlaybackFrame(this.current.audioEpoch) ?? null
    if (position === null) return
    const frame = this.video.takeDue(position)
    if (!frame) return
    this.displayed.set(frame.framebuffer)
    this.displayedFrameId = frame.frameId
    this.displayRevision += 1
    this.recycleVideo(frame)
    for (const listener of this.listeners) listener()
  }

  async inspectHardware(memoryStart = 0xc000): Promise<HardwareDebugSnapshot> {
    const { hardware } = await this.request({ type: 'inspect-hardware', memoryStart })
    if (!hardware) throw new Error('O emulador não entregou os dados de inspeção.')
    return hardware
  }

  get rewind(): RewindStatus {
    return this.current.rewind
  }

  readonly subscribeRewind = (listener: () => void): (() => void) => {
    this.rewindListeners.add(listener)
    return () => this.rewindListeners.delete(listener)
  }

  async setRewindEnabled(enabled: boolean): Promise<void> {
    await this.request({ type: 'rewind-config', enabled })
  }

  async beginRewind(): Promise<void> {
    await this.request({ type: 'rewind-start' })
    if (this.output && audioOwners.get(this.output) === this)
      await this.output.pause(this.current.audioEpoch)
  }

  async endRewind(): Promise<void> {
    await this.request({ type: 'rewind-end' })
    if (this.output && audioOwners.get(this.output) === this)
      await this.output.pause(this.current.audioEpoch)
  }

  async captureState(): Promise<MachineCheckpoint> {
    const { checkpoint } = await this.request({ type: 'capture-state' })
    if (!checkpoint) throw new Error('O emulador não entregou o estado solicitado.')
    return checkpoint
  }

  async loadState(checkpoint: unknown): Promise<void> {
    await this.request({ type: 'load-state', checkpoint })
    if (this.output && audioOwners.get(this.output) === this)
      await this.output.pause(this.current.audioEpoch)
  }

  exportBatteryRam(): Uint8Array | null {
    return this.battery?.slice() ?? null
  }

  async importBatteryRam(bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice()
    await this.request({ type: 'import-battery', bytes: copy }, [copy.buffer])
  }

  exportBatteryRtc(): CartridgeRtcState | null {
    return this.rtc ? { ...this.rtc } : null
  }

  async importBatteryState(
    bytes: Uint8Array,
    rtc: CartridgeRtcState,
    elapsedSeconds: number,
  ): Promise<void> {
    const copy = bytes.slice()
    await this.request({ type: 'import-battery-state', bytes: copy, rtc, elapsedSeconds }, [
      copy.buffer,
    ])
  }

  setButton(button: JoypadButton, pressed: boolean): void {
    this.post({ type: 'input', button, pressed })
  }

  releaseButtons(): void {
    this.post({ type: 'release-input' })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  async resume(): Promise<void> {
    await this.request({ type: 'play', playing: true })
    if (this.output && audioOwners.get(this.output) === this)
      await this.output.resume(this.current.audioEpoch)
  }

  async pause(): Promise<void> {
    if (this.disposed) return
    await this.request({ type: 'play', playing: false })
    if (this.output && audioOwners.get(this.output) === this)
      await this.output.pause(this.current.audioEpoch)
  }

  async advance(count: number): Promise<void> {
    await this.request({ type: 'step', count })
  }

  async attachAudio(output: AudioOutput): Promise<void> {
    const sampleRate = await output.prepare()
    const channel = new MessageChannel()
    try {
      const minimumEpoch = Math.max(this.current.audioEpoch, output.getDiagnostics().epoch) + 1
      await this.request(
        { type: 'audio-port', port: channel.port1, sampleRate, epoch: minimumEpoch },
        [channel.port1],
      )
      if (this.disposed) throw new Error('O cartucho foi fechado antes de ativar o som.')
      const epoch = this.current.audioEpoch
      audioOwners.set(output, this)
      this.output = output
      output.connect(channel.port2, epoch)
      if (this.current.playing) await output.resume(epoch)
      else await output.pause(epoch)
    } catch (cause) {
      channel.port2.close()
      if (!this.disposed) await this.request({ type: 'audio-disable' })
      throw cause
    }
  }

  async disableAudio(): Promise<void> {
    if (this.disposed) return
    await this.request({ type: 'audio-disable' })
    const output = this.output
    this.output = null
    if (output && audioOwners.get(output) === this) {
      audioOwners.delete(output)
      await output.pause(this.current.audioEpoch)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.video.clear()
    this.disposed = true
    this.worker.terminate()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('O cartucho foi fechado.'))
    }
    this.pending.clear()
    this.listeners.clear()
    this.rewindListeners.clear()
    this.errorListeners.clear()
    if (this.output && audioOwners.get(this.output) === this) audioOwners.delete(this.output)
  }

  private update(snapshot: EmulatorSnapshot): void {
    const previousSnapshot = this.current
    const previous = this.current?.rewind
    if (
      previous &&
      (Object.keys(previous) as (keyof RewindStatus)[]).every(
        (key) => previous[key] === snapshot.rewind[key],
      )
    )
      snapshot.rewind = previous
    this.current = snapshot
    if (!previousSnapshot || previousSnapshot.audioEpoch !== snapshot.audioEpoch)
      this.video.reset(snapshot.audioEpoch)
    if (!snapshot.audioDriven || !snapshot.playing || snapshot.rewind.active) {
      this.video.clear()
      let changed = !previousSnapshot || this.displayedFrameId !== snapshot.frameId
      if (!changed) {
        for (let index = 0; index < this.displayed.length; index += 1) {
          if (this.displayed[index] !== snapshot.framebuffer[index]) {
            changed = true
            break
          }
        }
      }
      this.displayed.set(snapshot.framebuffer)
      this.displayedFrameId = snapshot.frameId
      if (
        changed ||
        !previousSnapshot ||
        previousSnapshot.audioEpoch !== snapshot.audioEpoch ||
        previousSnapshot.playing !== snapshot.playing
      )
        this.displayRevision += 1
    }
    if (snapshot.batteryRam !== undefined) this.battery = snapshot.batteryRam
    if (snapshot.batteryRtc !== undefined) this.rtc = snapshot.batteryRtc
    for (const listener of this.listeners) listener()
    if (snapshot.rewind !== previous) for (const listener of this.rewindListeners) listener()
  }

  private reportError(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    for (const listener of this.errorListeners) listener(error)
  }

  private post(command: EmulatorCommand): void {
    if (!this.disposed) this.worker.postMessage({ id: 0, command })
  }

  private recycleVideo(frame: EmulatorVideoFrame): void {
    if (this.disposed) return
    this.worker.postMessage(
      {
        id: 0,
        command: {
          type: 'recycle-video',
          slot: frame.slot,
          token: frame.token,
          buffer: frame.framebuffer.buffer,
        },
      },
      [frame.framebuffer.buffer],
    )
  }

  private request(
    command: EmulatorCommand,
    transfer: Transferable[] = [],
  ): Promise<EmulatorReplyPayload> {
    if (this.disposed) return Promise.reject(new Error('O cartucho foi fechado.'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('O emulador não respondeu a tempo. Tente reiniciar o cartucho.'))
      }, 10_000)
      this.pending.set(id, { resolve, reject, timeout })
      try {
        this.worker.postMessage({ id, command }, transfer)
      } catch (cause) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }
}
