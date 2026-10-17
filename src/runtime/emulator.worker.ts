import { GameBoy } from '../core/gameboy'
import { DMG_CLOCK_HZ, DMG_FRAME_T_CYCLES } from '../core/model'
import type { EmulatorMessage, EmulatorRequest, EmulatorSnapshot } from './worker-protocol'
import type { MachineCheckpoint } from './worker-protocol'
import { stateInteger, stateRecord } from '../core/state/validation'
import { RewindHistory, REWIND_CAPTURE_HZ, REWIND_MAX_BYTES, REWIND_MAX_SECONDS } from './rewind'

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
let audioSampleRate: number | null = null
let rewindHistory: RewindHistory | null = null
let rewinding = false
let rewindTimer: ReturnType<typeof setTimeout> | null = null
let nextRewindCapture = 0

function checkpoint(): MachineCheckpoint {
  if (!device) throw new Error('O emulador ainda não está pronto.')
  if (device.bus.serial.pendingOutputBytes)
    serial = (serial + device.bus.serial.drainOutput().text).slice(-4096)
  return { version: 1, core: device.snapshotState(), serial }
}

function scheduleRewindCapture(): void {
  if (!device) return
  const index = Math.floor((device.bus.tCycles / DMG_CLOCK_HZ) * REWIND_CAPTURE_HZ) + 1
  nextRewindCapture = Math.floor((index * DMG_CLOCK_HZ) / REWIND_CAPTURE_HZ)
}

function captureRewind(force = false): void {
  if (!rewindHistory || !device || rewinding) return
  if (!force && device.bus.tCycles < nextRewindCapture) return
  rewindHistory.record(checkpoint(), device.bus.tCycles)
  scheduleRewindCapture()
}

function resetRewindHistory(): void {
  rewindHistory?.clear()
  captureRewind(true)
}

function stopRewindTimer(): void {
  if (rewindTimer !== null) clearTimeout(rewindTimer)
  rewindTimer = null
}

function restorePrevious(): void {
  const saved = rewindHistory?.stepBack()
  if (!device || !saved) return
  device.restoreState(saved.core)
  serial = saved.serial
  device.releaseButtons()
  device.bus.apu.discardSamples()
  publishedFrame = -1
}

function rewindClock(): void {
  rewindTimer = null
  if (!rewinding || !device) return
  try {
    restorePrevious()
    publishFrame()
    if ((rewindHistory?.stats.availableSeconds ?? 0) > 0)
      rewindTimer = setTimeout(rewindClock, 1000 / REWIND_CAPTURE_HZ)
  } catch (cause) {
    fail(cause)
  }
}

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
    romId: device.romId,
    rewind: {
      enabled: rewindHistory !== null,
      active: rewinding,
      ...(rewindHistory?.stats ?? {
        entries: 0,
        availableSeconds: 0,
        allocatedBytes: 0,
        usedBytes: 0,
        maxSeconds: REWIND_MAX_SECONDS,
        maxBytes: REWIND_MAX_BYTES,
      }),
    },
  }
  if (!rewinding && (includeBattery || publishedBatteryRevision !== state.batteryRevision)) {
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
  stopRewindTimer()
  rewinding = false
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
      captureRewind()
      device.bus.apu.discardSamples()
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
    captureRewind()
    const samples = apu.drainSamples()
    audioPort?.postMessage({ type: 'samples', samples, epoch: audioEpoch }, [samples.buffer])
    publishFrame()
  } catch (cause) {
    fail(cause)
  }
}

endpoint.onmessage = ({ data: request }) => {
  try {
    let captured: MachineCheckpoint | undefined
    const command = request.command
    if (command.type === 'init') {
      stopTimer()
      playing = false
      audioDriven = false
      audioSampleRate = null
      stopRewindTimer()
      rewinding = false
      rewindHistory = null
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
          if (rewinding) {
            if (command.playing) throw new Error('Solte o rewind antes de iniciar a partida.')
            break
          }
          stopTimer()
          playing = command.playing
          device.bus.apu.discardSamples()
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
          if (playing || rewinding)
            throw new Error('Pause a reprodução antes de avançar instruções.')
          if (!Number.isInteger(command.count) || command.count < 1 || command.count > 1000)
            throw new Error('A quantidade de instruções é inválida.')
          for (let index = 0; index < command.count; index += 1) {
            if (device.step() === 0) break
          }
          device.bus.apu.discardSamples()
          captureRewind()
          break
        case 'import-battery':
          if (playing || rewinding)
            throw new Error('Pause a reprodução antes de recuperar o progresso.')
          device.cartridge.importBatteryRam(command.bytes)
          resetRewindHistory()
          break
        case 'audio-port':
          if (rewinding) throw new Error('Solte o rewind antes de ativar o som.')
          stopTimer()
          audioPort?.close()
          audioPort = command.port
          audioEpoch = command.epoch
          audioSampleRate = command.sampleRate
          {
            const changedRate = device.bus.apu.sampleRate !== command.sampleRate
            device.bus.apu.setSampleRate(command.sampleRate)
            if (changedRate) resetRewindHistory()
          }
          device.bus.apu.discardSamples()
          audioDriven = true
          audioPort.onmessage = onAudio
          audioPort.start()
          break
        case 'audio-disable':
          audioDriven = false
          audioSampleRate = null
          audioEpoch += 1
          audioPort?.close()
          audioPort = null
          device.bus.apu.discardSamples()
          stopTimer()
          if (playing) clock()
          break
        case 'inspect':
          break
        case 'capture-state':
          if (playing || rewinding) throw new Error('Pause a reprodução antes de salvar um estado.')
          captured = checkpoint()
          break
        case 'load-state': {
          if (playing || rewinding)
            throw new Error('Pause a reprodução antes de carregar um estado.')
          const saved = stateRecord(command.checkpoint, 'Estado da sessão')
          stateInteger(saved.version, 1, 1, 'Versão da sessão')
          if (typeof saved.serial !== 'string' || saved.serial.length > 4096)
            throw new Error('A saída serial do estado é inválida.')
          device.restoreState(saved.core)
          if (
            audioDriven &&
            audioSampleRate !== null &&
            device.bus.apu.sampleRate !== audioSampleRate
          )
            device.bus.apu.setSampleRate(audioSampleRate)
          serial = saved.serial
          device.releaseButtons()
          audioEpoch += 1
          publishedFrame = -1
          publishedBatteryRevision = -1
          resetRewindHistory()
          break
        }
        case 'rewind-config':
          if (rewinding) throw new Error('Solte o rewind antes de alterar o histórico.')
          if (command.enabled && !rewindHistory) {
            rewindHistory = new RewindHistory()
            captureRewind(true)
          } else if (!command.enabled) rewindHistory = null
          break
        case 'rewind-start':
          if (rewinding) break
          if (!rewindHistory) throw new Error('Ative o rewind antes de voltar no tempo.')
          captureRewind(true)
          if (rewindHistory.stats.availableSeconds <= 0)
            throw new Error('Jogue um pouco para guardar um histórico e voltar no tempo.')
          stopTimer()
          playing = false
          device.releaseButtons()
          device.bus.apu.discardSamples()
          audioEpoch += 1
          rewinding = true
          restorePrevious()
          if (rewindHistory.stats.availableSeconds > 0)
            rewindTimer = setTimeout(rewindClock, 1000 / REWIND_CAPTURE_HZ)
          break
        case 'rewind-end':
          stopRewindTimer()
          rewinding = false
          playing = false
          device.releaseButtons()
          device.bus.apu.discardSamples()
          audioEpoch += 1
          scheduleRewindCapture()
          publishedBatteryRevision = -1
          break
      }
    }
    if (request.id === 0) return
    const state = snapshot(request.command.type === 'init')
    endpoint.postMessage(
      { type: 'reply', id: request.id, snapshot: state, checkpoint: captured },
      transfers(state),
    )
  } catch (cause) {
    endpoint.postMessage({
      type: 'reply',
      id: request.id,
      error: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
