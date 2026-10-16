export type ScreenPalette = readonly (readonly [number, number, number])[]

export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly image: ImageData

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly palette: ScreenPalette,
  ) {
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Seu navegador não disponibilizou a tela Canvas 2D.')
    this.context = context
    this.context.imageSmoothingEnabled = false
    this.image = context.createImageData(160, 144)
  }

  draw(framebuffer: Uint8Array, frameId: number): void {
    const target = this.image.data
    for (let index = 0; index < framebuffer.length; index += 1) {
      const shade = this.palette[framebuffer[index]!]!
      const offset = index * 4
      target[offset] = shade[0]
      target[offset + 1] = shade[1]
      target[offset + 2] = shade[2]
      target[offset + 3] = 255
    }
    this.context.putImageData(this.image, 0, 0)
    this.canvas.dataset.frameId = String(frameId)
  }
}
