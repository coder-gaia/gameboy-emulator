import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus, platform, release, totalmem } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { GameBoy } from '../../src/core/gameboy'
import type { GameBoyState } from '../../src/core/gameboy'
import { createVisualDiagnosticRom } from '../../src/core/diagnostics/visual-cartridge'
import { DMG_CLOCK_HZ } from '../../src/core/model'
import type { JoypadButton } from '../../src/core/joypad'

const WARMUP_REPETITIONS = 2
const MEASURED_REPETITIONS = 5
const MEASURED_FRAMES = 120
const DIRECTIONS = ['right', 'down', 'left', 'up'] as const

function sourceIdentity() {
  const coreRoot = resolve('src/core')
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
    }
  }
  visit(coreRoot)
  files.sort()
  const sourceHash = createHash('sha256')
  for (const file of files) {
    sourceHash.update(relative(coreRoot, file).split(sep).join('/'))
    sourceHash.update('\0')
    sourceHash.update(readFileSync(file))
    sourceHash.update('\0')
  }
  const bundle = readFileSync(resolve(process.argv[1]!), 'utf8')
  const region = bundle.indexOf('//#region scripts/benchmarks/core.ts')
  let baseRevision: string | null = null
  let worktreeDirty: boolean | null = null
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    baseRevision = git(['rev-parse', 'HEAD'])
    worktreeDirty =
      git(['status', '--porcelain', '--', 'src/core', 'scripts/benchmarks/core.ts']) !== ''
  } catch {
    // O hash continua identificando os arquivos quando Git não estiver disponível.
  }
  return {
    baseRevision,
    worktreeDirty,
    worktreeCoreSourceSha256: sourceHash.digest('hex'),
    coreSourceFiles: files.length,
    executedBundle: basename(process.argv[1]!),
    executedBundleSha256: createHash('sha256').update(bundle).digest('hex'),
    compiledCoreSha256: createHash('sha256')
      .update(region < 0 ? bundle : bundle.slice(0, region))
      .digest('hex'),
    scope:
      'O hash worktree descreve os arquivos src/core presentes. O hash compiledCore identifica o código compilado executado, inclusive ao comparar um bundle original preservado com um worktree modificado.',
  }
}

function advance(device: GameBoy, frames: number): number {
  let cycles = 0
  for (let frame = 0; frame < frames; frame += 1) {
    const consumed = device.runFrame()
    if (consumed === 0) throw new Error('O cartucho parou o clock durante o benchmark.')
    cycles += consumed
    // A produção PCM continua ativa; apenas a apresentação é descartada.
    device.bus.apu.discardSamples()
  }
  return cycles
}

function press(device: GameBoy, button: JoypadButton, followingFrames: number): void {
  device.setButton(button, true)
  advance(device, 3)
  device.setButton(button, false)
  advance(device, followingFrames)
}

function digest(state: GameBoyState): string {
  const json = JSON.stringify(state, (_key, value: unknown) =>
    value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value,
  )
  return createHash('sha256').update(json).digest('hex')
}

function createCase(id: 'garden' | '2048' | 'tobu-tobu-girl') {
  const rom =
    id === 'garden'
      ? createVisualDiagnosticRom()
      : new Uint8Array(
          readFileSync(
            resolve(
              id === '2048' ? 'public/games/2048/2048.gb' : 'public/games/tobu-tobu-girl/tobu.gb',
            ),
          ),
        )
  const device = new GameBoy(rom)
  if (id === 'garden') {
    advance(device, 20)
    press(device, 'a', 3)
  } else if (id === '2048') {
    advance(device, 180)
    press(device, 'start', 90)
    for (const direction of DIRECTIONS) press(device, direction, 20)
  } else {
    advance(device, 900)
    press(device, 'start', 90)
    press(device, 'start', 90)
    press(device, 'a', 150)
    press(device, 'right', 2)
  }
  device.releaseButtons()
  if (new Set(device.framebuffer).size < 2) {
    throw new Error(`O caso ${id} não chegou ao checkpoint visual esperado.`)
  }
  return { id, device, romBytes: rom.byteLength, checkpoint: device.snapshotState() }
}

function knownBuffers(romBytes: number, ramBytes: number) {
  const bytes = {
    internalRomCopies: romBytes * 2,
    cartridgeRam: ramBytes,
    cpuRegisters: 8,
    workRam: 0x2000,
    ioRegisters: 0x80,
    highRam: 0x7f,
    videoRam: 0x2000,
    objectRam: 0xa0,
    framebuffer: 160 * 144,
    selectedObjects: 10,
    audioRegisters: 0x17,
    waveRam: 16,
    audioQueue: 16_384 * 2 * Float32Array.BYTES_PER_ELEMENT,
    serialQueue: 4096,
  }
  return {
    bytes,
    totalBytes: Object.values(bytes).reduce((total, value) => total + value, 0),
    scope:
      'Buffers tipados conhecidos por máquina. Exclui objetos JS, ROM de entrada, snapshots, UI, Worker e filas do navegador.',
  }
}

function frameInput(device: GameBoy, frame: number): void {
  if (frame % 30 === 0) {
    device.releaseButtons()
    device.setButton(DIRECTIONS[(frame / 30) % DIRECTIONS.length]!, true)
  }
}

function execute(device: GameBoy): { elapsedMs: number; tCycles: number; speed: number } {
  const before = device.bus.tCycles
  const start = performance.now()
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) {
    frameInput(device, frame)
    advance(device, 1)
  }
  const elapsedMs = performance.now() - start
  const tCycles = device.bus.tCycles - before
  return { elapsedMs, tCycles, speed: tCycles / DMG_CLOCK_HZ / (elapsedMs / 1000) }
}

function pcmDigest(device: GameBoy): string {
  const hash = createHash('sha256')
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) {
    frameInput(device, frame)
    if (device.runFrame() === 0) throw new Error('O cartucho parou durante a verificação PCM.')
    const samples = device.bus.apu.drainSamples()
    hash.update(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength))
  }
  return hash.digest('hex')
}

function benchmark(id: 'garden' | '2048' | 'tobu-tobu-girl') {
  const { device, checkpoint, romBytes } = createCase(id)
  for (let warmup = 0; warmup < WARMUP_REPETITIONS; warmup += 1) {
    device.restoreState(checkpoint)
    execute(device)
  }
  const repetitions = []
  let finalDigest = ''
  for (let repetition = 0; repetition < MEASURED_REPETITIONS; repetition += 1) {
    device.restoreState(checkpoint)
    const result = execute(device)
    const nextDigest = digest(device.snapshotState())
    if (finalDigest !== '' && finalDigest !== nextDigest) {
      throw new Error(`A continuação do caso ${id} não foi determinística.`)
    }
    finalDigest = nextDigest
    repetitions.push(result)
    console.error(
      `${id}: repetição ${repetition + 1}/${MEASURED_REPETITIONS}, ${result.speed.toFixed(2)}x`,
    )
  }
  const speeds = repetitions.map((result) => result.speed).sort((a, b) => a - b)
  device.restoreState(checkpoint)
  const audioDigest = pcmDigest(device)
  if (digest(device.snapshotState()) !== finalDigest) {
    throw new Error(`A drenagem PCM do caso ${id} alterou a continuação da máquina.`)
  }
  return {
    id,
    romId: device.romId,
    checkpoint: {
      tCycles: checkpoint.bus.tCycles,
      frameId: checkpoint.bus.ppu.frameId,
      digest: digest(checkpoint),
    },
    finalDigest,
    pcmDigest: audioDigest,
    repetitions,
    medianSpeed: speeds[Math.floor(speeds.length / 2)]!,
    worstSpeed: speeds[0]!,
    knownBuffers: knownBuffers(romBytes, device.cartridge.metadata.ramSize),
  }
}

const outputPath = process.argv[2]
if (process.argv.length > 3 || outputPath?.startsWith('-')) {
  throw new Error('Uso: node .work/bench-core/core.js [caminho-do-resultado.json]')
}
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
    totalMemoryBytes: totalmem(),
  },
  protocol: {
    clockHz: DMG_CLOCK_HZ,
    warmupRepetitions: WARMUP_REPETITIONS,
    measuredRepetitions: MEASURED_REPETITIONS,
    measuredFrames: MEASURED_FRAMES,
    audioSampleRate: 48_000,
    speedFormula: 'T-cycles / 4194304 / segundos reais',
    measurement:
      'CPU, bus, PPU, DMA, timer e APU completos em Node. Checkpoint e hashes de estado/PCM ficam fora do intervalo medido. PCM é gerado e descartado a cada frame; uma passagem adicional sem cronometragem confere suas amostras.',
    limitation:
      'Medição desta máquina e deste runtime. Não representa hardware móvel, renderização, Web Audio ou desempenho de outro dispositivo.',
  },
  cases: [benchmark('garden'), benchmark('2048'), benchmark('tobu-tobu-girl')],
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (outputPath !== undefined) {
  const resolved = resolve(outputPath)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, json, 'utf8')
}
process.stdout.write(json)
