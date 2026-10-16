import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
const issues = []
const textExtensions = /\.(?:[cm]?[jt]sx?|json|md|css|html|svg|ya?ml|txt)$/i
for (const file of files) {
  if (!existsSync(file) || !textExtensions.test(file) || file === 'package-lock.json') continue
  const content = readFileSync(file, 'utf8')
  if (/[\u2013\u2014]/u.test(content))
    issues.push(`${file}: contém caractere de travessão proibido`)
}

// Verifica o histórico completo também no CI com fetch-depth 0.
let history = ''
try {
  history = execFileSync('git', ['log', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
} catch {
  // O primeiro check ocorre antes de existir um commit.
}
const parts = history.split('\0')
for (let offset = 0; offset + 5 < parts.length; offset += 6) {
  const [sha, author, email, committer, committerEmail, message] = parts.slice(offset, offset + 6)
  if (/codex|openai/i.test([author, email, committer, committerEmail].join(' ')))
    issues.push(`${sha.trim()}: identidade Git proibida`)
  if (/^co-authored-by:.*(?:codex|openai)/im.test(message))
    issues.push(`${sha.trim()}: coautoria proibida`)
  if (/[\u2013\u2014]/u.test(message)) issues.push(`${sha.trim()}: travessão na mensagem de commit`)
  if (
    !/^(?:feat|fix|chore|docs|test|refactor|perf|style|build|ci)(?:\([a-z0-9/-]+\))?!?: [^\r\n]+/u.test(
      message,
    )
  )
    issues.push(`${sha.trim()}: título fora de Conventional Commits`)
}
if (issues.length) {
  console.error(issues.join('\n'))
  process.exitCode = 1
} else console.log('Regras de escrita, histórico e autoria verificadas.')
