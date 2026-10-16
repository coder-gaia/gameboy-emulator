import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = JSON.parse(
  await readFile(resolve(projectRoot, 'tests/roms/manifest.json'), 'utf8'),
)
const verifyOnly = process.argv.includes('--verify')
const knownOptions = new Set(['--verify', '--acid2'])
if (process.argv.slice(2).some((argument) => !knownOptions.has(argument))) {
  throw new Error('Opções aceitas: --verify e --acid2.')
}

function projectPath(path) {
  const absolute = resolve(projectRoot, path)
  const within = relative(projectRoot, absolute)
  if (within.startsWith('..') || within === '' || isAbsolute(within)) {
    throw new Error(`Caminho fora da pasta do projeto: ${path}`)
  }
  return absolute
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function ensureFile(entry, url) {
  const path = projectPath(entry.path)
  try {
    const existing = await readFile(path)
    if (digest(existing) !== entry.sha256) {
      throw new Error(`SHA-256 divergente: ${entry.path}. O arquivo não foi sobrescrito.`)
    }
    return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (verifyOnly || !url) {
      throw new Error(`Arquivo ausente: ${entry.path}. Execute node scripts/test-roms/fetch.mjs.`, {
        cause: error,
      })
    }
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Download falhou: HTTP ${response.status}, ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (digest(bytes) !== entry.sha256) throw new Error(`SHA-256 divergente no download: ${url}`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes, { flag: 'wx' })
}

for (const entry of manifest.tests) {
  const suite = manifest.suites[entry.suite]
  const url =
    entry.suite === 'blargg'
      ? `https://raw.githubusercontent.com/retrio/gb-test-roms/${suite.revision}/${entry.sourcePath.split('/').map(encodeURIComponent).join('/')}`
      : undefined
  if (entry.suite === 'blargg' && !entry.path.startsWith('.work/roms/blargg/')) {
    throw new Error('ROMs Blargg precisam permanecer em .work/roms/blargg/.')
  }
  if (entry.suite === 'blargg') {
    const within = relative(resolve(projectRoot, '.work/roms/blargg'), projectPath(entry.path))
    if (within.startsWith('..') || within === '' || isAbsolute(within)) {
      throw new Error('Destino de download fora de .work/roms/blargg/.')
    }
  }
  await ensureFile(entry, url)
}

if (process.argv.includes('--acid2')) {
  const acid2 = JSON.parse(
    await readFile(resolve(projectRoot, 'tests/roms/acid2-manifest.json'), 'utf8'),
  )
  await ensureFile(acid2.rom)
  await ensureFile(acid2.reference)
}

console.log(
  `${manifest.tests.length} ROMs verificadas por SHA-256${process.argv.includes('--acid2') ? ', com ROM e referência dmg-acid2' : ''}.`,
)
