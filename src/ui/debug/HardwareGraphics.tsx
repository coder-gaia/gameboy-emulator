import { useEffect, useRef } from 'react'
import styles from './HardwareInspector.module.css'

const SHADES = [
  [240, 239, 232],
  [180, 183, 170],
  [111, 119, 102],
  [48, 57, 42],
] as const

function colorAt(vram: Uint8Array, tile: number, x: number, y: number): number {
  const offset = tile * 16 + y * 2
  const shift = 7 - x
  return (((vram[offset + 1] ?? 0) >> shift) & 1) * 2 + (((vram[offset] ?? 0) >> shift) & 1)
}

function paint(image: ImageData, x: number, y: number, color: number): void {
  const offset = (y * image.width + x) * 4
  const shade = SHADES[color]!
  image.data[offset] = shade[0]
  image.data[offset + 1] = shade[1]
  image.data[offset + 2] = shade[2]
  image.data[offset + 3] = 255
}

export function TileAtlas({ vram }: { vram: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pixels = useRef<ImageData | null>(null)

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const image = (pixels.current ??= context.createImageData(128, 192))
    for (let tile = 0; tile < 384; tile += 1) {
      const left = (tile % 16) * 8
      const top = Math.floor(tile / 16) * 8
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) paint(image, left + x, top + y, colorAt(vram, tile, x, y))
      }
    }
    context.putImageData(image, 0, 0)
  }, [vram])

  return (
    <figure className={styles.graphics}>
      <canvas
        ref={canvas}
        width={128}
        height={192}
        className={styles.tiles}
        role="img"
        aria-label="384 tiles da VRAM em 16 colunas e 24 linhas"
      >
        Os 384 padrões de 8 por 8 pixels armazenados entre 8000 e 97FF.
      </canvas>
      <figcaption>
        384 padrões de 8 por 8 pixels, de $8000 a $97FF. Tons neutros representam os quatro índices
        de cor, sem aplicar a paleta do jogo.
      </figcaption>
    </figure>
  )
}

export function OamPreview({
  vram,
  oam,
  lcdc,
}: {
  vram: Uint8Array
  oam: Uint8Array
  lcdc: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pixels = useRef<ImageData | null>(null)

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const image = (pixels.current ??= context.createImageData(80, 64))
    image.data.fill(0)
    const height = (lcdc & 4) !== 0 ? 16 : 8
    for (let index = 0; index < 40; index += 1) {
      const flags = oam[index * 4 + 3]!
      const tile = oam[index * 4 + 2]!
      const firstTile = height === 16 ? tile & 0xfe : tile
      const left = (index % 10) * 8
      const top = Math.floor(index / 10) * 16
      for (let y = 0; y < height; y += 1) {
        const sourceY = (flags & 0x40) !== 0 ? height - 1 - y : y
        for (let x = 0; x < 8; x += 1) {
          const sourceX = (flags & 0x20) !== 0 ? 7 - x : x
          const color = colorAt(vram, firstTile + (sourceY >> 3), sourceX, sourceY & 7)
          if (color !== 0) paint(image, left + x, top + y, color)
        }
      }
    }
    context.putImageData(image, 0, 0)
  }, [vram, oam, lcdc])

  return (
    <figure className={styles.graphics}>
      <canvas
        ref={canvas}
        width={80}
        height={64}
        className={styles.objects}
        role="img"
        aria-label="Padrões dos 40 sprites da OAM em 10 colunas e 4 linhas"
      >
        Padrões dos objetos na ordem da OAM.
      </canvas>
      <figcaption>
        Padrões na ordem da OAM, com espelhamento X/Y e altura de {(lcdc & 4) !== 0 ? 16 : 8}{' '}
        pixels. A prévia não compõe posições, prioridade ou paletas da tela.
      </figcaption>
    </figure>
  )
}
