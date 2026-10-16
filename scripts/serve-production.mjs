import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer, validateHeaderName, validateHeaderValue } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = fileURLToPath(new URL('../dist/', import.meta.url))
const DEFAULT_PORT = 4174
const REVALIDATE = 'public, max-age=0, must-revalidate'
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.gb': 'application/octet-stream',
  '.gbc': 'application/octet-stream',
}

/** Subconjunto usado pelo projeto: caminhos exatos ou com um único asterisco. */
export function parseHeaders(source) {
  const rules = []
  let current = null
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (line.length > 2000) throw new Error('Uma linha de _headers excede 2000 caracteres.')
    if (!/^\s/.test(line)) {
      const pattern = line.trim()
      if (!pattern.startsWith('/') || (pattern.match(/\*/g)?.length ?? 0) > 1)
        throw new Error('O servidor de QA aceita somente caminhos locais com até um asterisco.')
      const expression = new RegExp(
        `^${pattern
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      )
      current = { pattern, expression, headers: Object.create(null) }
      rules.push(current)
      if (rules.length > 100) throw new Error('_headers excede o limite de 100 regras.')
      continue
    }
    const header = /^\s+([!#$%&'*+.^_`|~0-9A-Za-z-]+):\s*(.*?)\s*$/.exec(line)
    if (!current || !header) throw new Error('Regra de cabeçalho inválida em _headers.')
    const name = header[1].toLowerCase()
    const value = header[2]
    validateHeaderName(name)
    validateHeaderValue(name, value)
    current.headers[name] = current.headers[name] ? `${current.headers[name]}, ${value}` : value
  }
  return rules
}

export function headersForPath(pathname, rules) {
  const headers = Object.create(null)
  for (const rule of rules) {
    if (!rule.expression.test(pathname)) continue
    for (const [name, value] of Object.entries(rule.headers))
      headers[name] = headers[name] ? `${headers[name]}, ${value}` : value
  }
  return headers
}

function staysInside(root, target) {
  const difference = relative(root, target)
  return difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
}

function sendText(response, status, message) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(message)
}

/** Servidor de QA local. Importar este módulo não abre portas. */
export async function createProductionServer({ root = DEFAULT_ROOT, headersSource } = {}) {
  const canonicalRoot = await realpath(root)
  if (!(await stat(canonicalRoot)).isDirectory())
    throw new Error('O diretório do build estático é inválido.')
  const rules = parseHeaders(
    headersSource ?? (await readFile(resolve(canonicalRoot, '_headers'), 'utf8')),
  )
  const fallbackHeaders = headersForPath(
    '/',
    rules.filter((rule) => rule.pattern === '/*'),
  )
  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(fallbackHeaders)) response.setHeader(name, value)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD')
      sendText(response, 405, 'Método não permitido.')
      return
    }
    let pathname
    try {
      const rawPath = (request.url ?? '/').split('?')[0]
      pathname = decodeURIComponent(rawPath)
    } catch {
      sendText(response, 400, 'O caminho solicitado é inválido.')
      return
    }
    const hasControlCharacter = [...pathname].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
    if (
      !pathname.startsWith('/') ||
      pathname.startsWith('//') ||
      pathname.includes('\\') ||
      pathname.includes(':') ||
      hasControlCharacter
    ) {
      sendText(response, 400, 'O caminho solicitado é inválido.')
      return
    }
    const segments = pathname.split('/')
    if (segments.includes('..') || segments.includes('.')) {
      sendText(response, 403, 'Caminho não permitido.')
      return
    }
    if (
      segments.some((segment) => segment.startsWith('.')) ||
      ['_headers', '_redirects', '_worker.js'].includes(segments.at(-1))
    ) {
      sendText(response, 404, 'Arquivo não encontrado.')
      return
    }
    for (const [name, value] of Object.entries(headersForPath(pathname, rules)))
      response.setHeader(name, value)
    const target = resolve(canonicalRoot, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!staysInside(canonicalRoot, target)) {
      sendText(response, 403, 'Caminho não permitido.')
      return
    }
    try {
      // A verificação também impede que um symlink do build exponha arquivos externos.
      const canonicalTarget = await realpath(target)
      if (!staysInside(canonicalRoot, canonicalTarget)) {
        sendText(response, 403, 'Caminho não permitido.')
        return
      }
      const metadata = await stat(canonicalTarget)
      if (!metadata.isFile()) {
        sendText(response, 404, 'Arquivo não encontrado.')
        return
      }
      const etag = `W/"${metadata.size.toString(16)}-${metadata.mtimeMs.toString(16)}"`
      response.setHeader('etag', etag)
      response.setHeader('last-modified', metadata.mtime.toUTCString())
      if (!response.hasHeader('cache-control')) response.setHeader('cache-control', REVALIDATE)
      const candidates = request.headers['if-none-match']?.split(',').map((value) => value.trim())
      if (candidates?.includes(etag) || candidates?.includes('*')) {
        response.writeHead(304)
        response.end()
        return
      }
      response.setHeader(
        'content-type',
        MIME_TYPES[extname(canonicalTarget).toLowerCase()] ?? 'application/octet-stream',
      )
      response.setHeader('content-length', metadata.size)
      if (request.method === 'HEAD') {
        response.writeHead(200)
        response.end()
        return
      }
      await pipeline(createReadStream(canonicalTarget), response)
    } catch (cause) {
      if (response.destroyed) return
      if (response.headersSent) {
        response.destroy()
        return
      }
      if (cause?.code === 'ENOENT' || cause?.code === 'ENOTDIR')
        sendText(response, 404, 'Arquivo não encontrado.')
      else sendText(response, 500, 'Não foi possível ler o arquivo do build.')
    }
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  return server
}

function readPort(args) {
  if (args.length === 0) return DEFAULT_PORT
  let value
  if (args.length === 2 && args[0] === '--port') value = args[1]
  else if (args.length === 1 && args[0].startsWith('--port=')) value = args[0].slice(7)
  else throw new Error('Uso: node scripts/serve-production.mjs [--port 4174]')
  if (!/^\d+$/.test(value) || Number(value) > 65_535)
    throw new Error('A porta deve ser um inteiro entre 0 e 65535.')
  return Number(value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const port = readPort(process.argv.slice(2))
    const server = await createProductionServer()
    server.on('error', (cause) => {
      console.error(`Não foi possível abrir o servidor de QA: ${cause.message}`)
      process.exitCode = 1
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`Build de produção para QA: http://127.0.0.1:${server.address().port}/`)
    })
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        server.close()
        server.closeAllConnections()
      })
  } catch (cause) {
    console.error(`Não foi possível preparar o servidor de QA: ${cause.message}`)
    process.exitCode = 1
  }
}
