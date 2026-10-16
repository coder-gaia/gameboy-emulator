import { computeHeaderChecksum } from '../cartridge'

/** Programa próprio, sem assets de terceiros: aritmética, loop, WRAM e serial OK. */
export function createDiagnosticRom(): Uint8Array {
  const rom = new Uint8Array(0x8000)
  const title = 'POCKET TEST'
  for (let index = 0; index < title.length; index += 1) rom[0x134 + index] = title.charCodeAt(index)
  rom.set([0xc3, 0x50, 0x01], 0x100) // JP 0150, preserva o cabeçalho.
  rom[0x14d] = computeHeaderChecksum(rom)
  const program = [
    0x31,
    0xfe,
    0xff, // LD SP,FFFE
    0x3e,
    0x0f, // LD A,0F
    0xc6,
    0x01, // ADD A,01
    0x06,
    0x03, // LD B,03
    0x05, // DEC B
    0x20,
    0xfd, // JR NZ,DEC B
    0x21,
    0x00,
    0xc0, // LD HL,C000
    0x77, // LD (HL),A
  ]
  for (const byte of [0x4f, 0x4b]) {
    program.push(
      0x3e,
      byte, // LD A,byte
      0xe0,
      0x01, // LDH (SB),A
      0x3e,
      0x81, // LD A,81
      0xe0,
      0x02, // LDH (SC),A
      0xf0,
      0x02, // Aguarda a transferência interna completa.
      0xcb,
      0x7f, // BIT 7,A
      0x20,
      0xfa, // JR NZ,LDH A,(SC)
    )
  }
  program.push(0x76) // HALT
  rom.set(program, 0x150)
  return rom
}
