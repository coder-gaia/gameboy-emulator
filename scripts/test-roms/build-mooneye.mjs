import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = JSON.parse(
  await readFile(resolve(projectRoot, 'tests/roms/manifest.json'), 'utf8'),
)
const mbc1Manifest = JSON.parse(
  await readFile(resolve(projectRoot, 'tests/roms/mbc1-manifest.json'), 'utf8'),
)
const extendedManifest = JSON.parse(
  await readFile(resolve(projectRoot, 'tests/roms/mbc-extended-manifest.json'), 'utf8'),
)
if (
  [mbc1Manifest, extendedManifest].some(
    (entry) => entry.revision !== manifest.suites.mooneye.revision,
  )
) {
  throw new Error('Os manifestos Mooneye precisam usar a mesma revisão de fonte.')
}
const [sourceArgument, assemblerArgument, linkerArgument] = process.argv.slice(2)
if (!sourceArgument || !assemblerArgument || !linkerArgument || process.argv.length !== 5) {
  throw new Error(
    'Uso: node scripts/test-roms/build-mooneye.mjs <fonte> <wla-gb> <wlalink>. Consulte docs/test-roms.md.',
  )
}

const sourceRoot = resolve(sourceArgument)
const assembler = resolve(assemblerArgument)
const linker = resolve(linkerArgument)
const sourceWithin = relative(resolve(projectRoot, '.work/roms'), sourceRoot)
if (sourceWithin.startsWith('..') || sourceWithin === '' || isAbsolute(sourceWithin)) {
  throw new Error('As fontes precisam ficar dentro de .work/roms/.')
}
// A exceção vale apenas para leituras deste clone local, sem mudar a configuração Git.
const gitArguments = ['-c', `safe.directory=${sourceRoot.replaceAll('\\', '/')}`, '-C', sourceRoot]
const sourceRevision = execFileSync('git', [...gitArguments, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
if (sourceRevision !== manifest.suites.mooneye.revision) {
  throw new Error(`Revisão Mooneye incorreta: ${sourceRevision}.`)
}
const changes = execFileSync(
  'git',
  [...gitArguments, 'status', '--porcelain', '--untracked-files=no'],
  {
    encoding: 'utf8',
  },
).trim()
if (changes) throw new Error('As fontes Mooneye possuem alterações. Use a revisão original.')

const outputRoot = resolve(projectRoot, '.work/roms/mooneye-built')
const outputWithin = relative(projectRoot, outputRoot)
if (outputWithin.startsWith('..') || isAbsolute(outputWithin)) {
  throw new Error('A saída da compilação precisa ficar dentro do projeto.')
}

let count = 0
const entries = [
  ...manifest.tests.filter((test) => test.suite === 'mooneye'),
  ...mbc1Manifest.tests,
  ...extendedManifest.tests,
]
for (const entry of entries) {
  const relativePath = entry.sourcePath.replace(/\.s$/, '')
  const object = resolve(outputRoot, `${relativePath}.o`)
  const linkFile = resolve(outputRoot, `${relativePath}.link`)
  const rom = resolve(outputRoot, `${relativePath}.gb`)
  await mkdir(dirname(object), { recursive: true })
  execFileSync(assembler, ['-I', resolve(sourceRoot, 'common'), '-o', object, entry.sourcePath], {
    cwd: sourceRoot,
    stdio: 'inherit',
  })
  await writeFile(linkFile, `[objects]\n${object}\n`)
  execFileSync(linker, ['-d', '-S', linkFile, rom], { cwd: sourceRoot, stdio: 'inherit' })
  const actual = createHash('sha256')
    .update(await readFile(rom))
    .digest('hex')
  if (actual !== entry.sha256) {
    throw new Error(
      `Build divergente em ${entry.id}: esperado ${entry.sha256}, recebido ${actual}.`,
    )
  }
  count += 1
}

console.log(`${count} ROMs Mooneye reconstruídas e idênticas às fixtures.`)
