/** O barramento não avança o relógio em read8/write8. A CPU chama tick por ciclo. */
export interface CpuBus {
  read8(address: number): number
  write8(address: number, value: number): void
  tick(tCycles: number): void
}

/** Estado em fronteira de instrução. O barramento deve ser salvo separadamente. */
export interface CpuSnapshot {
  version: 1
  a: number
  f: number
  b: number
  c: number
  d: number
  e: number
  h: number
  l: number
  sp: number
  pc: number
  ime: boolean
  imeEnableDelay: number
  halted: boolean
  stopped: boolean
  haltBug: boolean
  totalTCycles: number
}

export const CPU_FLAGS = {
  Z: 0x80,
  N: 0x40,
  H: 0x20,
  C: 0x10,
} as const
