export const ROM_BANK_SIZE = 0x4000
export const MIN_ROM_SIZE = 0x8000
export const MAX_ROM_SIZE = 0x800000

export type CartridgeMapper = 'ROM_ONLY' | 'MBC1' | 'MBC2' | 'MBC3' | 'MBC5' | 'UNKNOWN'
export type CgbMode = 'dmg' | 'compatible' | 'required'

export interface CartridgeMetadata {
  readonly title: string
  readonly mapper: CartridgeMapper
  readonly cartridgeType: number
  readonly romSize: number
  readonly ramSize: number
  readonly romBanks: number
  readonly romSizeCode: number
  readonly ramSizeCode: number
  readonly hasBattery: boolean
  readonly cgbMode: CgbMode
  readonly headerChecksum: number
  readonly checksumValid: boolean
  readonly warnings: readonly string[]
  readonly isSupported: boolean
}

const ROM_SIZES: Readonly<Record<number, number>> = {
  0x00: 0x8000,
  0x01: 0x10000,
  0x02: 0x20000,
  0x03: 0x40000,
  0x04: 0x80000,
  0x05: 0x100000,
  0x06: 0x200000,
  0x07: 0x400000,
  0x08: 0x800000,
  0x52: 72 * ROM_BANK_SIZE,
  0x53: 80 * ROM_BANK_SIZE,
  0x54: 96 * ROM_BANK_SIZE,
}

const RAM_SIZES: Readonly<Record<number, number>> = {
  0x00: 0,
  0x01: 0x800,
  0x02: 0x2000,
  0x03: 0x8000,
  0x04: 0x20000,
  0x05: 0x10000,
}

const BATTERY_TYPES = new Set([
  0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e, 0x22, 0xfd, 0xfe, 0xff,
])

function mapperFor(type: number): CartridgeMapper {
  if (type === 0x00 || type === 0x08 || type === 0x09) return 'ROM_ONLY'
  if (type >= 0x01 && type <= 0x03) return 'MBC1'
  if (type === 0x05 || type === 0x06) return 'MBC2'
  if (type >= 0x0f && type <= 0x13) return 'MBC3'
  if (type >= 0x19 && type <= 0x1e) return 'MBC5'
  return 'UNKNOWN'
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(2, '0').toUpperCase()}`
}

export function computeHeaderChecksum(rom: Uint8Array): number {
  if (rom.length < 0x14e) throw new Error('Arquivo pequeno demais para conter o cabeçalho.')
  let checksum = 0
  for (let address = 0x134; address <= 0x14c; address += 1) {
    checksum = (checksum - rom[address]! - 1) & 0xff
  }
  return checksum
}

export function parseCartridgeHeader(rom: Uint8Array): CartridgeMetadata {
  if (rom.length < MIN_ROM_SIZE) {
    throw new Error('ROM inválida: o arquivo precisa ter pelo menos 32 KiB.')
  }
  if (rom.length > MAX_ROM_SIZE) {
    throw new Error('ROM inválida: o arquivo ultrapassa o limite de 8 MiB.')
  }
  if (rom.length % ROM_BANK_SIZE !== 0) {
    throw new Error('ROM inválida: o tamanho precisa ser múltiplo de bancos de 16 KiB.')
  }

  const romSizeCode = rom[0x148]!
  const ramSizeCode = rom[0x149]!
  const romSize = ROM_SIZES[romSizeCode]
  const ramSize = RAM_SIZES[ramSizeCode]
  if (romSize === undefined) {
    throw new Error(`Código de tamanho de ROM desconhecido: ${hex(romSizeCode)}.`)
  }
  if (ramSize === undefined) {
    throw new Error(`Código de tamanho de RAM desconhecido: ${hex(ramSizeCode)}.`)
  }
  if (romSize !== rom.length) {
    throw new Error(
      `Tamanho de ROM incompatível: o cabeçalho declara ${romSize} bytes, mas o arquivo tem ${rom.length}.`,
    )
  }

  const cartridgeType = rom[0x147]!
  const mapper = mapperFor(cartridgeType)
  const cgbFlag = rom[0x143]!
  const cgbMode: CgbMode =
    cgbFlag === 0xc0 ? 'required' : (cgbFlag & 0x80) !== 0 ? 'compatible' : 'dmg'
  const titleEnd = cgbMode === 'dmg' ? 0x144 : 0x13f
  let title = ''
  for (let address = 0x134; address < titleEnd; address += 1) {
    const value = rom[address]!
    if (value === 0) break
    title += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '?'
  }

  const headerChecksum = rom[0x14d]!
  const checksumValid = computeHeaderChecksum(rom) === headerChecksum
  const warnings: string[] = []
  if (!checksumValid) warnings.push('Checksum do cabeçalho inválido. A ROM pode estar modificada.')
  if (ramSizeCode === 0x01) {
    warnings.push('RAM de 2 KiB é uma convenção antiga de homebrew sem cartucho oficial conhecido.')
  }
  if (romSizeCode >= 0x52) {
    warnings.push('O tamanho de ROM declarado utiliza um código histórico sem cartucho confirmado.')
  }
  if (mapper !== 'ROM_ONLY' && mapper !== 'MBC1') {
    warnings.push(
      `O controlador ${mapper === 'UNKNOWN' ? hex(cartridgeType) : mapper} ainda não é executado.`,
    )
  }
  if (mapper === 'ROM_ONLY' && romSize > MIN_ROM_SIZE) {
    warnings.push('Cartuchos sem MBC podem endereçar no máximo 32 KiB de ROM.')
  }
  if (mapper === 'ROM_ONLY' && ramSize > 0x2000) {
    warnings.push('Cartuchos sem MBC podem endereçar no máximo 8 KiB de RAM.')
  }
  if (cartridgeType === 0x00 && ramSize > 0) {
    warnings.push('O tipo ROM ONLY não declara hardware de RAM externa.')
  }
  if (mapper === 'MBC1' && (romSize > 0x200000 || (romSize & (romSize - 1)) !== 0)) {
    warnings.push('MBC1 exige ROM em potência de dois, com no máximo 2 MiB.')
  }
  if (mapper === 'MBC1' && ramSize > 0x8000) {
    warnings.push('MBC1 pode endereçar no máximo 32 KiB de RAM.')
  }
  if (mapper === 'MBC1' && romSize >= 0x100000 && ramSize > 0x2000) {
    warnings.push('MBC1 com ROM de 1 MiB ou mais admite no máximo 8 KiB de RAM.')
  }
  if (cartridgeType === 0x01 && ramSize > 0) {
    warnings.push('O tipo MBC1 sem RAM não declara hardware de RAM externa.')
  }
  if (cgbMode === 'required') warnings.push('Esta ROM exige Game Boy Color. O perfil atual é DMG.')

  return {
    title: title.trim() || 'Sem título',
    mapper,
    cartridgeType,
    romSize,
    ramSize,
    romBanks: romSize / ROM_BANK_SIZE,
    romSizeCode,
    ramSizeCode,
    hasBattery: BATTERY_TYPES.has(cartridgeType),
    cgbMode,
    headerChecksum,
    checksumValid,
    warnings,
    isSupported:
      cgbMode !== 'required' &&
      ((mapper === 'ROM_ONLY' &&
        romSize === MIN_ROM_SIZE &&
        ramSize <= 0x2000 &&
        (cartridgeType !== 0x00 || ramSize === 0)) ||
        (mapper === 'MBC1' &&
          romSize <= 0x200000 &&
          (romSize & (romSize - 1)) === 0 &&
          ramSize <= 0x8000 &&
          (romSize < 0x100000 || ramSize <= 0x2000) &&
          (cartridgeType !== 0x01 || ramSize === 0))),
  }
}
