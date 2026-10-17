import type { GameBoy } from '../core/gameboy'

export interface CapturedAudioVideoFrame {
  readonly frameId: number
  readonly pcmFrame: number
  /** O consumidor deve copiar durante o callback; este buffer pertence ao núcleo. */
  readonly framebuffer: Uint8Array
}

/** Mesmo orçamento e instruções de runCycles; só observa fronteiras de apresentação. */
export function runAudioVideoBudget(
  device: GameBoy,
  budget: number,
  producedPcmFrames: number,
  onFrame: (frame: CapturedAudioVideoFrame) => void,
): number {
  if (!Number.isSafeInteger(producedPcmFrames) || producedPcmFrames < 0)
    throw new RangeError('A posição PCM produzida precisa ser um inteiro não negativo.')
  const ppu = device.bus.ppu
  const previous = ppu.setPresentationObserver(() => {
    onFrame({
      frameId: device.frameId,
      pcmFrame: producedPcmFrames + device.bus.apu.pendingSampleFrames,
      framebuffer: device.framebuffer,
    })
  })
  try {
    return device.runCycles(budget)
  } finally {
    ppu.setPresentationObserver(previous)
  }
}
