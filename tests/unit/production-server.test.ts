import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  createProductionServer,
  headersForPath,
  parseHeaders,
} from '../../scripts/serve-production.mjs'

interface TestResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

describe('servidor do build de produção', () => {
  let directory: string
  let server: Server
  let port: number

  function get(path: string, method = 'GET', headers: Record<string, string> = {}) {
    return new Promise<TestResponse>((resolveResponse, reject) => {
      const pending = request({ host: '127.0.0.1', port, path, method, headers }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () =>
          resolveResponse({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        )
      })
      pending.on('error', reject)
      pending.end()
    })
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pocket-qa-server-'))
    const root = join(directory, 'dist')
    const outside = join(directory, 'outside')
    await mkdir(join(root, 'assets'), { recursive: true })
    await mkdir(join(root, 'games'), { recursive: true })
    await mkdir(outside)
    await writeFile(join(root, 'index.html'), '<!doctype html><title>QA</title>')
    await writeFile(join(root, 'assets', 'worker-hash.js'), 'postMessage("pronto")')
    await writeFile(join(root, 'assets', 'style-hash.css'), 'body { color: black; }')
    await writeFile(join(root, 'assets', 'font-hash.woff2'), Buffer.from([1, 2, 3]))
    await writeFile(join(root, 'games', 'demo.gb'), Buffer.from([0, 128, 255]))
    await writeFile(join(root, '.secret'), 'oculto')
    await writeFile(join(outside, 'secret.txt'), 'externo')
    await symlink(outside, join(root, 'assets', 'external'), 'junction')
    await writeFile(
      join(root, '_headers'),
      `${await readFile('public/_headers', 'utf8')}\n/\n  X-Root-Only: sim\n`,
    )
    server = await createProductionServer({ root })
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.')
    port = address.port
  })

  afterAll(async () => {
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()))
      })
    }
    if (directory) {
      const difference = relative(resolve(tmpdir()), resolve(directory))
      if (
        difference === '..' ||
        difference.startsWith(`..${sep}`) ||
        isAbsolute(difference) ||
        !basename(directory).startsWith('pocket-qa-server-')
      )
        throw new Error('Diretório de limpeza fora da área temporária de teste.')
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('aplica CSP, política de permissões e revalidação ao HTML', async () => {
    const response = await get('/')
    expect(response.status).toBe(200)
    expect(response.body.toString()).toContain('<title>QA</title>')
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(response.headers['content-security-policy']).toContain("worker-src 'self'")
    expect(response.headers['content-security-policy']).toContain("script-src 'self';")
    expect(response.headers['content-security-policy']).toContain(
      "style-src 'self' 'unsafe-inline'",
    )
    expect(response.headers['content-security-policy']).toContain("connect-src 'self'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(response.headers['permissions-policy']).toContain('microphone=()')
    expect(response.headers['permissions-policy']).not.toContain('gamepad=()')
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate')
  })

  it('envia JS de Worker com MIME executável e cache imutável apenas em assets', async () => {
    const script = await get('/assets/worker-hash.js?versao=1')
    expect(script.status).toBe(200)
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const cartridge = await get('/games/demo.gb')
    expect(cartridge.status).toBe(200)
    expect(cartridge.headers['content-type']).toBe('application/octet-stream')
    expect(cartridge.headers['cache-control']).toBe('public, max-age=0, must-revalidate')
    expect(cartridge.body).toEqual(Buffer.from([0, 128, 255]))
    expect((await get('/assets/style-hash.css')).headers['content-type']).toBe(
      'text/css; charset=utf-8',
    )
    expect((await get('/assets/font-hash.woff2')).headers['content-type']).toBe('font/woff2')
  })

  it('não propaga cabeçalhos exclusivos da raiz para assets ou erros de outros caminhos', async () => {
    expect((await get('/')).headers['x-root-only']).toBe('sim')
    expect((await get('/assets/worker-hash.js')).headers['x-root-only']).toBeUndefined()
    expect((await get('/games/missing.gb')).headers['x-root-only']).toBeUndefined()
    expect((await get('/%zz')).headers['x-root-only']).toBeUndefined()
  })

  it('responde HEAD sem corpo e revalida um ETag com 304', async () => {
    const response = await get('/index.html')
    const head = await get('/index.html', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
    expect(Number(head.headers['content-length'])).toBe(response.body.length)
    const revalidated = await get('/index.html', 'GET', {
      'if-none-match': String(response.headers.etag),
    })
    expect(revalidated.status).toBe(304)
    expect(revalidated.body.length).toBe(0)
    expect(revalidated.headers['cache-control']).toBe('public, max-age=0, must-revalidate')
  })

  it.each([
    '/assets/../index.html',
    '/%2e%2e/outside/secret.txt',
    '/assets/%2E%2E/%2E%2E/outside/secret.txt',
    '/assets/%2e%2e%2f%2e%2e%2foutside/secret.txt',
  ])('rejeita traversal literal ou codificado: %s', async (path) => {
    const response = await get(path)
    expect(response.status).toBe(403)
    expect(response.body.toString()).not.toContain('externo')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it.each(['/assets%5c..%5csecret.txt', '/assets/worker-hash.js:%24DATA', '/%00', '/%zz'])(
    'rejeita separadores Windows, ADS e codificação inválida: %s',
    async (path) => {
      expect((await get(path)).status).toBe(400)
    },
  )

  it('impede leitura por symlink externo, arquivos ocultos e arquivos de controle', async () => {
    expect((await get('/assets/external/secret.txt')).status).toBe(403)
    for (const path of ['/.secret', '/_headers', '/_redirects', '/_worker.js'])
      expect((await get(path)).status).toBe(404)
  })

  it('não substitui ROM ausente por HTML nem lista diretórios', async () => {
    const missing = await get('/games/missing.gb')
    expect(missing.status).toBe(404)
    expect(missing.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect((await get('/assets/')).status).toBe(404)
    const post = await get('/', 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
  })
})

describe('regras locais de cabeçalho', () => {
  it('combina regras correspondentes sem confundir caminhos exatos com prefixos', () => {
    const rules = parseHeaders(
      '/*\n  X-Test: geral\n/assets/*\n  X-Test: asset\n/\n  X-Root: sim\n',
    )
    expect(headersForPath('/assets/a.js', rules)['x-test']).toBe('geral, asset')
    expect(headersForPath('/assets-falso/a.js', rules)['x-test']).toBe('geral')
    expect(headersForPath('/assets/a.js', rules)['x-root']).toBeUndefined()
    expect(headersForPath('/', rules)['x-root']).toBe('sim')
  })

  it('falha de modo explícito se _headers usar sintaxe não suportada pelo servidor de QA', () => {
    expect(() => parseHeaders('  X-Test: sem caminho')).toThrow()
    expect(() => parseHeaders('https://example.com/*\n  X-Test: externo')).toThrow()
    expect(() => parseHeaders('/**\n  X-Test: muitos asteriscos')).toThrow()
    expect(() => parseHeaders('/*\n  cabeçalho sem dois pontos')).toThrow()
    expect(() => parseHeaders('/*\n  X-Test: valor\rforjado')).toThrow()
  })
})
