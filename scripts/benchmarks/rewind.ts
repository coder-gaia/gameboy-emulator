import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus, platform, release } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { GameBoy } from '../../src/core/gameboy'
import { createVisualDiagnosticRom } from '../../src/core/diagnostics/visual-cartridge'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import {
  encodeToBuffer,
  MAX_REWIND_STATE_BYTES,
  REWIND_CAPTURE_HZ,
  REWIND_MAX_BYTES,
  REWIND_MAX_SECONDS,
  RewindHistory,
} from '../../src/runtime/rewind'
import type { RewindStats } from '../../src/runtime/rewind'
import type { MachineCheckpoint } from '../../src/runtime/worker-protocol'

const SECONDS = 25
const REPETITIONS = 5
const RESTORES = 100
const DIRECTIONS = ['right', 'down', 'left', 'up'] as const
type CaseId = 'garden' | 'tobu-tobu-girl' | 'mbc1-2mib'

function sourceIdentity() {
  const paths: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.ts')) paths.push(path)
    }
  }
  visit('src/core')
  visit('src/runtime/rewind')
  paths.push('scripts/benchmarks/rewind.ts')
  paths.sort()
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(relative('.', path).split(sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  let baseRevision: string | null = null
  let worktreeDirty: boolean | null = null
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    baseRevision = git(['rev-parse', 'HEAD'])
    worktreeDirty =
      git([
        'status',
        '--porcelain',
        '--',
        'src/core',
        'src/runtime/rewind',
        'scripts/benchmarks/rewind.ts',
      ]) !== ''
  } catch {
    // O hash identifica as fontes mesmo sem acesso ao Git.
  }
  return {
    baseRevision,
    worktreeDirty,
    sourceSha256: hash.digest('hex'),
    executedBundleSha256: createHash('sha256').update(readFileSync(process.argv[1]!)).digest('hex'),
    scope:
      'src/core, src/runtime/rewind e este script. Worker, React, Canvas e Worklet não executam neste benchmark.',
  }
}

function advanceFrames(device: GameBoy, count: number): void {
  for (let frame = 0; frame < count; frame += 1) {
    if (device.runFrame() === 0) throw new Error('O cartucho parou durante a preparação.')
    device.bus.apu.discardSamples()
  }
}

function press(device: GameBoy, button: 'start' | 'a', followingFrames: number): void {
  device.setButton(button, true)
  advanceFrames(device, 3)
  device.setButton(button, false)
  advanceFrames(device, followingFrames)
}

function createCase(id: CaseId) {
  let rom: Uint8Array
  if (id === 'tobu-tobu-girl') {
    rom = new Uint8Array(readFileSync('public/games/tobu-tobu-girl/tobu.gb'))
  } else if (id === 'garden') rom = createVisualDiagnosticRom()
  else {
    rom = new Uint8Array(2 * 1024 * 1024)
    rom.set(createVisualDiagnosticRom())
    for (let bank = 2; bank < 128; bank += 1) rom.fill(bank, bank * 0x4000, (bank + 1) * 0x4000)
    rom[0x147] = 3
    rom[0x148] = 6
    rom[0x149] = 2
    let checksum = 0
    for (let address = 0x134; address < 0x14d; address += 1) checksum -= rom[address]! + 1
    rom[0x14d] = checksum & 255
  }
  const device = new GameBoy(rom)
  if (id === 'tobu-tobu-girl') {
    advanceFrames(device, 900)
    press(device, 'start', 90)
    press(device, 'start', 90)
    press(device, 'a', 150)
  } else advanceFrames(device, 20)
  if (id === 'mbc1-2mib') device.bus.write8Direct(0, 0x0a)
  device.releaseButtons()
  return { id, device, romBytes: rom.length, checkpoint: device.snapshotState() }
}

function capture(device: GameBoy, serial: string): MachineCheckpoint {
  return { version: 1, core: device.snapshotState(), serial }
}

function digest(value: unknown): string {
  const buffer = new Uint8Array(MAX_REWIND_STATE_BYTES)
  const length = encodeToBuffer(value, buffer)
  return createHash('sha256').update(buffer.subarray(0, length)).digest('hex')
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((first, second) => first - second)
  if (fraction === 0.5 && sorted.length % 2 === 0)
    return (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!
}

function execute(device: GameBoy, id: CaseId, enabled: boolean) {
  const history = enabled ? new RewindHistory() : null
  let serial = ''
  history?.record(capture(device, serial), device.bus.tCycles)
  const initial = device.bus.tCycles
  const pcmHash = createHash('sha256')
  let pcmEnergy = 0
  let elapsedMs = 0
  let captures = enabled ? 1 : 0
  for (let interval = 1; interval <= SECONDS * REWIND_CAPTURE_HZ; interval += 1) {
    const started = performance.now()
    device.releaseButtons()
    device.setButton(DIRECTIONS[Math.floor((interval - 1) / 5) % DIRECTIONS.length]!, true)
    if (id === 'tobu-tobu-girl') {
      device.setButton('b', true)
      device.setButton('a', interval % 7 === 0)
    }
    if (id === 'mbc1-2mib') {
      // Estressa alterações reais de RAM na fixture própria; não modifica uma ROM distribuída.
      for (let byte = 0; byte < 64; byte += 1)
        device.bus.write8Direct(0xa000 + ((interval * 64 + byte) & 0x1fff), interval & 255)
    }
    const target = initial + Math.floor((interval * DMG_CLOCK_HZ) / REWIND_CAPTURE_HZ)
    if (device.runCycles(target - device.bus.tCycles) === 0)
      throw new Error('O cartucho parou durante a janela medida.')
    if (device.bus.serial.pendingOutputBytes)
      serial = (serial + device.bus.serial.drainOutput().text).slice(-4096)
    if (history) {
      history.record(capture(device, serial), device.bus.tCycles)
      captures += 1
    }
    const samples = device.bus.apu.drainSamples()
    elapsedMs += performance.now() - started
    // Hash e energia não entram no tempo de avanço/captura.
    pcmHash.update(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength))
    for (const sample of samples) pcmEnergy += sample * sample
  }
  const tCycles = device.bus.tCycles - initial
  return {
    history,
    metrics: {
      enabled,
      elapsedMs,
      tCycles,
      speed: tCycles / DMG_CLOCK_HZ / (elapsedMs / 1000),
      captures,
      finalStateSha256: digest(capture(device, serial)),
      pcmSha256: pcmHash.digest('hex'),
      pcmEnergy,
      history: history?.stats ?? null,
    },
  }
}

function assertLimits(stats: RewindStats): void {
  if (
    stats.availableSeconds > REWIND_MAX_SECONDS ||
    stats.entries > 201 ||
    stats.allocatedBytes > REWIND_MAX_BYTES ||
    stats.usedBytes > stats.allocatedBytes
  )
    throw new Error('O histórico ultrapassou um limite durante a medição.')
}

function benchmark(id: CaseId) {
  const { device, romBytes, checkpoint } = createCase(id)
  console.error(`${id}: aquecimento de 25 segundos emulados por modo.`)
  for (const enabled of [false, true]) {
    device.restoreState(checkpoint)
    execute(device, id, enabled)
  }
  const forward: ReturnType<typeof execute>['metrics'][] = []
  let retainedHistory: RewindHistory | null = null
  let stateHash: string | null = null
  let audioHash: string | null = null
  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    // Alterna ordem para reduzir vantagem de aquecimento de um único modo.
    for (const enabled of repetition % 2 === 0 ? [false, true] : [true, false]) {
      device.restoreState(checkpoint)
      const result = execute(device, id, enabled)
      if (stateHash !== null && result.metrics.finalStateSha256 !== stateHash)
        throw new Error('Capturar rewind mudou a continuação da máquina.')
      if (audioHash !== null && result.metrics.pcmSha256 !== audioHash)
        throw new Error('Capturar rewind mudou o PCM da máquina.')
      stateHash = result.metrics.finalStateSha256
      audioHash = result.metrics.pcmSha256
      if (result.history) {
        assertLimits(result.history.stats)
        retainedHistory = result.history
      }
      forward.push(result.metrics)
      console.error(
        `${id}: repetição ${repetition + 1}/${REPETITIONS}, rewind ${enabled ? 'ativo' : 'desligado'}, ${result.metrics.speed.toFixed(3)}x.`,
      )
    }
  }
  if (!retainedHistory) throw new Error('Histórico ausente ao medir restaurações.')
  const historyBeforeRestores = retainedHistory.stats
  const restoreSamples = []
  for (let index = 0; index < RESTORES; index += 1) {
    const decodeStart = performance.now()
    const saved = retainedHistory.stepBack()
    const decodeMs = performance.now() - decodeStart
    if (!saved) throw new Error('A fixture não reteve 100 pontos para medir restaurações.')
    const restoreStart = performance.now()
    // A API segura externa continua validando a máquina candidata e copiando a ROM.
    device.restoreState(saved.core)
    const restoreMs = performance.now() - restoreStart
    if (digest(device.snapshotState()) !== digest(saved.core))
      throw new Error('A restauração do rewind não produziu o estado integral esperado.')
    restoreSamples.push({ decodeMs, restoreMs, totalMs: decodeMs + restoreMs })
  }
  const disabled = forward.filter((sample) => !sample.enabled)
  const enabled = forward.filter((sample) => sample.enabled)
  const disabledMedianMs = percentile(
    disabled.map((sample) => sample.elapsedMs),
    0.5,
  )
  const enabledMedianMs = percentile(
    enabled.map((sample) => sample.elapsedMs),
    0.5,
  )
  const after = retainedHistory.stats
  assertLimits(after)
  return {
    id,
    romId: device.romId,
    romBytes,
    ramBytes: device.cartridge.metadata.ramSize,
    forward,
    forwardSummary: {
      disabledMedianSpeed: percentile(
        disabled.map((sample) => sample.speed),
        0.5,
      ),
      enabledMedianSpeed: percentile(
        enabled.map((sample) => sample.speed),
        0.5,
      ),
      disabledMedianMs,
      enabledMedianMs,
      overheadPercent: (enabledMedianMs / disabledMedianMs - 1) * 100,
      stateAndPcmIdentical: true,
    },
    historyBeforeRestores,
    restores: {
      count: restoreSamples.length,
      medianDecodeMs: percentile(
        restoreSamples.map((sample) => sample.decodeMs),
        0.5,
      ),
      p95DecodeMs: percentile(
        restoreSamples.map((sample) => sample.decodeMs),
        0.95,
      ),
      medianRestoreMs: percentile(
        restoreSamples.map((sample) => sample.restoreMs),
        0.5,
      ),
      p95RestoreMs: percentile(
        restoreSamples.map((sample) => sample.restoreMs),
        0.95,
      ),
      medianTotalMs: percentile(
        restoreSamples.map((sample) => sample.totalMs),
        0.5,
      ),
      p95TotalMs: percentile(
        restoreSamples.map((sample) => sample.totalMs),
        0.95,
      ),
      samples: restoreSamples,
    },
    historyAfterRestores: after,
  }
}

const outputPath = process.argv[2]
if (process.argv.length > 3 || outputPath?.startsWith('-'))
  throw new Error('Uso: node .work/bench-rewind/rewind.js [caminho-do-resultado.json]')
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: sourceIdentity(),
  environment: {
    node: process.version,
    v8: process.versions.v8,
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'desconhecida',
    availableParallelism: availableParallelism(),
  },
  protocol: {
    secondsPerPass: SECONDS,
    captureHz: REWIND_CAPTURE_HZ,
    warmupPassesPerMode: 1,
    measuredPassesPerMode: REPETITIONS,
    restoresPerCase: RESTORES,
    audioSampleRate: 48_000,
    order: 'Desligado/ativo nas repetições ímpares; ativo/desligado nas pares.',
    speedFormula: 'T-cycles / 4194304 / segundos reais medidos.',
    measurement:
      'Tempo acumulado de avanço, entrada programada, drenagem PCM e captura síncrona a cada 0,1 s emulado. Preparação, restauração inicial, alocação da arena e hashes ficam fora das janelas forward. Cada restore mede separadamente XOR+decode e GameBoy.restoreState seguro.',
    memoryScope:
      'Arena única de 8 MiB inclui âncora, cursor, scratch e ring de deltas. Não inclui payloads decodificados, snapshots temporários, candidatas de restauração, ROM, heap ou consumo total do processo.',
    limitation:
      'Node nesta máquina, sem Worker, Canvas, AudioWorklet, renderização ou hardware móvel. Entradas são programadas; o cenário Tobu não garante permanência na mesma fase durante toda a janela.',
  },
  cases: [benchmark('garden'), benchmark('tobu-tobu-girl'), benchmark('mbc1-2mib')],
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (outputPath !== undefined) {
  const path = resolve(outputPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, json, 'utf8')
}
process.stdout.write(json)
