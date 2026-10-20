import { expect, test } from '@playwright/test'
import { PNG } from 'pngjs'

function headTags(head: string, tagName: 'meta' | 'link'): Record<string, string>[] {
  return [...head.matchAll(new RegExp('<' + tagName + '\\b[^>]*>', 'gi'))].map(([tag]) =>
    Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(([, name, , value]) => [
        name!.toLowerCase(),
        value!,
      ]),
    ),
  )
}

test('oferece uma prévia estática válida para o crawler do LinkedIn', async ({ request }) => {
  const headers = { 'user-agent': 'LinkedInBot/1.0 (+https://www.linkedin.com)' }
  const response = await request.get('/', { headers })
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toMatch(/^text\/html\b/i)

  // O crawler recebe metadados no HTML inicial, sem executar o aplicativo.
  const html = await response.text()
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html)?.[1]
  expect(head).toBeDefined()
  const metadata = new Map(
    headTags(head!, 'meta').map((attributes) => [
      attributes.property ?? attributes.name ?? '',
      attributes.content ?? '',
    ]),
  )
  const canonical = headTags(head!, 'link').find(
    (attributes) => attributes.rel === 'canonical',
  )?.href
  expect(canonical).toBe('https://pocketlab.alexandregaia.me/')
  expect(metadata.get('og:url')).toBe(canonical)
  expect(metadata.get('og:type')).toBe('website')
  expect(metadata.get('og:title')).toBe(/<title>(.*?)<\/title>/i.exec(head!)?.[1])
  expect(metadata.get('og:description')).toBe(metadata.get('description'))
  expect(metadata.get('og:description')!.length).toBeGreaterThan(40)

  const imageUrl = new URL(metadata.get('og:image')!)
  expect(imageUrl.href).toBe(new URL('/og-image.png', canonical).href)
  expect(metadata.get('twitter:card')).toBe('summary_large_image')
  expect(metadata.get('twitter:title')).toBe(metadata.get('og:title'))
  expect(metadata.get('twitter:description')).toBe(metadata.get('og:description'))
  expect(metadata.get('twitter:image')).toBe(imageUrl.href)
  expect(metadata.get('og:image:alt')!.length).toBeGreaterThan(20)
  expect(metadata.get('twitter:image:alt')).toBe(metadata.get('og:image:alt'))

  // Usa o mesmo artefato em localhost e em produção, sem buscar a demo no teste local.
  const image = await request.get(imageUrl.pathname + imageUrl.search, { headers })
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toMatch(/^image\/png(?:;|$)/i)
  expect(image.headers()['cache-control']).toContain('must-revalidate')
  expect(metadata.get('og:image:type')).toBe('image/png')
  const bytes = await image.body()
  expect(bytes.length).toBeLessThan(5_000_000)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const decoded = PNG.sync.read(bytes)
  expect([decoded.width, decoded.height]).toEqual([1200, 627])
  expect(Number(metadata.get('og:image:width'))).toBe(decoded.width)
  expect(Number(metadata.get('og:image:height'))).toBe(decoded.height)
})
