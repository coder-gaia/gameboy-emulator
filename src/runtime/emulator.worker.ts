import { GameBoy } from '../core/gameboy'
import { DMG_CLOCK_HZ, DMG_FRAME_T_CYCLES } from '../core/model'
import type { EmulatorMessage, EmulatorRequest, EmulatorSnapshot } from './worker-protocol'

interface WorkerEndpoint {
  onmessage: ((event: MessageEvent<EmulatorRequest>) => void) | null
  postMessage(message: EmulatorMessage, transfer?: Transferable[]): void
}
const endpoint = globalThis as unknown as WorkerEndpoint
let device: GameBoy | null = null
let playing = false
let timer: ReturnType<typeof setTimeout> | null = null
let previous = 0
let debt = 0
let serial = ''
let publishedFrame = -1
let publishedAt = 0
let publishedBatteryRevision = -1
let audioPort: MessagePort | null = null
let audioEpoch = 0
let audioDriven = false

function snapshot(includeBattery = false): EmulatorSnapshot {
  if (!device) throw new Error('O emulador ainda não está pronto.')
  if (device.bus.serial.pendingOutputBytes)
    serial = (serial + device.bus.serial.drainOutput().text).slice(-4096)
  const cpu = device.cpu.snapshot()
  const state: EmulatorSnapshot = {
    framebuffer: device.framebuffer.slice(),
    frameId: device.frameId,
    cpu,
    nextBytes: [0, 1, 2].map((offset) => device!.bus.read8Direct(cpu.pc + offset)),
    serial,
    batteryRevision: device.cartridge.batteryRevision,
    playing,
    audioEpoch,
  }
  if (includeBattery || publishedBatteryRevision !== state.batteryRevision) {
    state.batteryRam = device.cartridge.exportBatteryRam()
    publishedBatteryRevision = state.batteryRevision
  }
  publishedFrame = state.frameId
  publishedAt = performance.now()
  return state
}

function transfers(state: EmulatorSnapshot): Transferable[] {
  const buffers: Transferable[] = [state.framebuffer.buffer]
  if (state.batteryRam) buffers.push(state.batteryRam.buffer)
  return buffers
}

function publishFrame(): void {
  if (!device || (device.frameId === publishedFrame && performance.now() - publishedAt < 100))
    return
  const state = snapshot()
  endpoint.postMessage({ type: 'frame', snapshot: state }, transfers(state))
}

function stopTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  previous = 0
  debt = 0
}

function fail(cause: unknown): void {
  playing = false
  stopTimer()
  endpoint.postMessage({
    type: 'error',
    error: cause instanceof Error ? cause.message : String(cause),
  })
}

function clock(): void {
  timer = null
  if (!device || !playing || audioDriven) return
  try {
    const now = performance.now()
    if (previous) {
      debt = Math.min(
        debt + (Math.min(now - previous, 100) * DMG_CLOCK_HZ) / 1000,
        DMG_FRAME_T_CYCLES * 4,
      )
      if (debt >= 1) debt -= device.runCycles(Math.floor(debt))
      device.bus.apu.clearSamples()
      publishFrame()
    }
    previous = now
    timer = setTimeout(clock, 8)
  } catch (cause) {
    fail(cause)
  }
}

function onAudio(event: MessageEvent<{ type: string; frames: number; epoch: number }>): void {
  const request = event.data
  if (
    request.type !== 'need' ||
    request.epoch !== audioEpoch ||
    !playing ||
    !audioDriven ||
    !device
  )
    return
  try {
    if (!Number.isInteger(request.frames) || request.frames < 1 || request.frames > 4096)
      throw new Error('O orçamento de áudio recebido é inválido.')
    const apu = device.bus.apu
    const maximum = Math.ceil((request.frames * DMG_CLOCK_HZ) / apu.sampleRate) + 24
    device.runCycles(maximum)
    const samples = apu.drainSamples()
    audioPort?.postMessage({ type: 'samples', samples, epoch: audioEpoch }, [samples.buffer])
    publishFrame()
  } catch (cause) {
    fail(cause)
  }
}

endpoint.onmessage = ({ data: request }) => {
  try {
    const command = request.command
    if (command.type === 'init') {
      stopTimer()
      playing = false
      audioDriven = false
      audioPort?.close()
      audioPort = null
      device = new GameBoy(command.rom)
      serial = ''
      publishedFrame = -1
      publishedBatteryRevision = -1
    } else {
      if (!device) throw new Error('O emulador ainda não está pronto.')
      switch (command.type) {
        case 'play':
          stopTimer()
          playing = command.playing
          device.bus.apu.clearSamples()
          if (!playing) {
            device.releaseButtons()
            audioEpoch += 1
          } else if (!audioDriven) clock()
          break
        case 'input':
          device.setButton(command.button, playing && command.pressed)
          break
        case 'release-input':
          device.releaseButtons()
          break
        case 'step':
          if (playing) throw new Error('Pause a reprodução antes de avançar instruções.')
          if (!Number.isInteger(command.count) || command.count < 1 || command.count > 1000)
            throw new Error('A quantidade de instruções é inválida.')
          for (let index = 0; index < command.count; index += 1) {
            if (device.step() === 0) break
          }
          device.bus.apu.clearSamples()
          break
        case 'import-battery':
          if (playing) throw new Error('Pause a reprodução antes de recuperar o progresso.')
          device.cartridge.importBatteryRam(command.bytes)
          break
        case 'audio-port':
          stopTimer()
          audioPort?.close()
          audioPort = command.port
          audioEpoch = command.epoch
          device.bus.apu.setSampleRate(command.sampleRate)
          device.bus.apu.clearSamples()
          audioDriven = true
          audioPort.onmessage = onAudio
          audioPort.start()
          break
        case 'audio-disable':
          audioDriven = false
          audioEpoch += 1
          audioPort?.close()
          audioPort = null
          device.bus.apu.clearSamples()
          stopTimer()
          if (playing) clock()
          break
        case 'inspect':
          break
      }
    }
    if (request.id === 0) return
    const state = snapshot(request.command.type === 'init')
    endpoint.postMessage({ type: 'reply', id: request.id, snapshot: state }, transfers(state))
  } catch (cause) {
    endpoint.postMessage({
      type: 'reply',
      id: request.id,
      error: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
