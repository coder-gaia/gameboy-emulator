/** Montador mínimo para a fixture, sem dependência de navegador ou assets externos. */
class FixtureAssembler {
  private readonly labels = new Map<string, number>()
  private readonly fixups: { address: number; label: string; relative: boolean }[] = []
  private cursor = 0x150

  constructor(private readonly rom: Uint8Array) {}

  emit(...bytes: number[]): void {
    this.rom.set(bytes, this.cursor)
    this.cursor += bytes.length
  }

  label(name: string): void {
    this.labels.set(name, this.cursor)
  }

  address(opcode: number, label: string): void {
    this.fixups.push({ address: this.cursor + 1, label, relative: false })
    this.emit(opcode, 0, 0)
  }

  relative(opcode: number, label: string): void {
    this.fixups.push({ address: this.cursor + 1, label, relative: true })
    this.emit(opcode, 0)
  }

  finish(): void {
    for (const fixup of this.fixups) {
      const target = this.labels.get(fixup.label)
      if (target === undefined) throw new Error(`Rótulo ausente: ${fixup.label}.`)
      if (fixup.relative) {
        const distance = target - fixup.address - 1
        if (distance < -128 || distance > 127) throw new Error('Salto relativo fora do alcance.')
        this.rom[fixup.address] = distance & 0xff
      } else {
        this.rom[fixup.address] = target & 0xff
        this.rom[fixup.address + 1] = target >>> 8
      }
    }
  }
}

const GARDEN_TILES = [
  ['00000000', '00000000', '00000000', '00000000', '00000000', '00000000', '00000000', '00000000'],
  ['11111111', '11111111', '00111110', '11100111', '11111111', '11111111', '11001111', '11111000'],
  ['11111111', '11111111', '11111111', '11111111', '11111111', '12111111', '11111121', '11111111'],
  ['00000000', '00000000', '12211221', '23322332', '11111111', '11111111', '11111111', '11111111'],
  ['22222222', '23222222', '22222232', '22232222', '22222222', '22322223', '22222222', '33333333'],
  ['11111111', '11100111', '11033011', '11100111', '11122111', '11221111', '11121111', '11111111'],
  ['00122100', '01233210', '12322321', '23333232', '12323321', '01233210', '00122100', '00000000'],
  ['11122111', '11123111', '11123111', '11123111', '11123111', '11233211', '12222221', '11111111'],
  ['00000000', '00010000', '00000000', '10000000', '00000010', '00000000', '00001000', '00000000'],
  ['11111111', '11111111', '11222111', '12333211', '12323211', '11222111', '11111111', '11111111'],
  ['00000000', '00000000', '00001111', '00010000', '00100000', '01000000', '00111111', '00000000'],
  ['00000000', '00000000', '11000000', '00110000', '00001000', '00000100', '11111000', '00000000'],
  ['00000000', '00000000', '00000000', '02300320', '00233200', '00000000', '00000000', '00000000'],
  ['11111111', '11111111', '11122111', '11233211', '12233211', '11222111', '11121111', '11111111'],
  ['11111111', '11133111', '11300311', '11300311', '11133111', '11122111', '11122111', '11233211'],
  ['00000000', '00000000', '11111111', '22222222', '11111111', '00000000', '00000000', '00000000'],
] as const

function encodeTiles(patterns: readonly (readonly string[])[]): Uint8Array {
  const bytes = new Uint8Array(patterns.length * 16)
  patterns.forEach((pattern, tile) => {
    pattern.forEach((row, y) => {
      for (let x = 0; x < 8; x += 1) {
        const color = Number(row[x])
        bytes[tile * 16 + y * 2] = bytes[tile * 16 + y * 2]! | ((color & 1) << (7 - x))
        bytes[tile * 16 + y * 2 + 1] = bytes[tile * 16 + y * 2 + 1]! | ((color >>> 1) << (7 - x))
      }
    })
  })
  return bytes
}

function createGardenMap(): Uint8Array {
  const map = new Uint8Array(32 * 32)
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      let tile = 0
      if (y === 4 || y >= 17) tile = 1
      else if (y === 5) tile = 3
      else if (y === 16) tile = 4
      else if (y >= 6) {
        tile = x % 16 === 10 || x % 16 === 11 ? 8 : 2
        if (tile !== 8 && (x * 3 + y * 7) % 17 === 0) tile = 5
        if (tile === 2 && (x * 11 + y * 5) % 29 === 0) tile = 9
      }
      map[y * 32 + x] = tile
    }
  }
  for (const x of [2, 13, 25]) {
    map[32 + x] = 10
    map[32 + x + 1] = 11
  }
  map[2 * 32 + 8] = 12
  map[3 * 32 + 20] = 12
  for (const [x, y] of [
    [3, 8],
    [15, 11],
    [24, 8],
  ]) {
    map[y! * 32 + x!] = 6
    map[(y! + 1) * 32 + x!] = 7
  }
  map[12 * 32 + 6] = 14
  map[8 * 32 + 18] = 13
  return map
}

function emitCopy(
  assembler: FixtureAssembler,
  source: number,
  target: number,
  length: number,
): void {
  assembler.emit(
    0x21,
    source & 0xff,
    source >>> 8, // LD HL,origem
    0x11,
    target & 0xff,
    target >>> 8, // LD DE,destino
    0x01,
    length & 0xff,
    length >>> 8, // LD BC,tamanho
  )
  assembler.address(0xcd, 'copy')
}

/** ROM própria para validar vídeo. Todo o cenário é enviado à VRAM pela CPU SM83. */
export function createVisualDiagnosticRom(): Uint8Array {
  const rom = new Uint8Array(0x8000)
  const title = 'POCKET GARDEN'
  for (let index = 0; index < title.length; index += 1) rom[0x134 + index] = title.charCodeAt(index)
  rom.set([0xc3, 0x50, 0x01], 0x100)
  rom[0x40] = 0xd9 // RETI da interrupção de VBlank.
  const tiles = encodeTiles(GARDEN_TILES)
  rom.set(tiles, 0x1000)
  rom.set(createGardenMap(), 0x2000)
  const assembler = new FixtureAssembler(rom)
  assembler.emit(0xf3, 0x31, 0xfe, 0xff, 0xaf, 0xe0, 0x40) // DI, SP, LCD desligado.
  emitCopy(assembler, 0x1000, 0x8000, tiles.length)
  emitCopy(assembler, 0x2000, 0x9800, 1024)
  assembler.emit(0x3e, 0xe4, 0xe0, 0x47) // Paleta identidade.
  assembler.emit(0xaf, 0xe0, 0x42, 0xe0, 0x43, 0xe0, 0x0f)
  assembler.emit(0x3e, 1, 0xea, 0xff, 0xff) // IE: VBlank.
  assembler.emit(0x3e, 0x91, 0xe0, 0x40, 0xfb, 0x00) // LCD e interrupções ativos.
  assembler.label('frame')
  assembler.emit(0x76, 0xf0, 0x43, 0x3c, 0xe0, 0x43) // HALT; SCX += 1.
  assembler.address(0xc3, 'frame')
  assembler.label('copy')
  assembler.emit(0x2a, 0x12, 0x13, 0x0b, 0x78, 0xb1)
  assembler.relative(0x20, 'copy')
  assembler.emit(0xc9)
  assembler.finish()
  let checksum = 0
  for (let address = 0x134; address <= 0x14c; address += 1) checksum -= rom[address]! + 1
  rom[0x14d] = checksum & 0xff
  return rom
}
