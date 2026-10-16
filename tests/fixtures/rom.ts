export interface TestRomOptions {
  title?: string
  cartridgeType?: number
  romSizeCode?: number
  ramSizeCode?: number
  cgbFlag?: number
  program?: readonly number[]
  programOffset?: number
}

export function updateTestHeaderChecksum(rom: Uint8Array): void {
  let total = 0
  for (let address = 0x134; address < 0x14d; address += 1) total += rom[address]! + 1
  rom[0x14d] = -total & 0xff
}

/** Fixture própria: cabeçalho sintético e nenhum logo, jogo ou boot ROM de terceiros. */
export function buildTestRom(options: TestRomOptions = {}): Uint8Array {
  const sizeCode = options.romSizeCode ?? 0
  const banks =
    sizeCode === 0x52 ? 72 : sizeCode === 0x53 ? 80 : sizeCode === 0x54 ? 96 : 2 << sizeCode
  const rom = new Uint8Array(banks * 0x4000)
  const title = options.title ?? 'TEST FIXTURE'
  const titleLength = (options.cgbFlag ?? 0) & 0x80 ? 11 : 16
  for (let index = 0; index < Math.min(title.length, titleLength); index += 1) {
    rom[0x134 + index] = title.charCodeAt(index) & 0x7f
  }
  rom[0x100] = 0xc3
  rom[0x101] = 0x50
  rom[0x102] = 0x01
  if ((options.cgbFlag ?? 0) !== 0) rom[0x143] = options.cgbFlag!
  rom[0x147] = options.cartridgeType ?? 0
  rom[0x148] = sizeCode
  rom[0x149] = options.ramSizeCode ?? 0
  if (options.program) rom.set(options.program, options.programOffset ?? 0x150)
  updateTestHeaderChecksum(rom)
  return rom
}
