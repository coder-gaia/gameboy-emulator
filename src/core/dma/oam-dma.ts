import { stateBoolean, stateInteger, stateRecord } from '../state/validation'

export interface OamDmaState {
  readonly version: 1
  readonly source: number
  readonly pendingSource: number
  readonly startupTCycles: number
  readonly byteTCycles: number
  readonly index: number
  readonly transferring: boolean
  readonly register: number
}

/**
 * OAM DMA: o M-cycle de escrita e um M-cycle de espera precedem a cópia.
 * Depois, 160 leituras/escritas ocupam 4T cada, totalizando 640T de cópia.
 * Uma nova escrita em FF46 agenda reinício e mantém a transferência anterior
 * durante o startup. O acesso interno não passa pelos bloqueios da CPU.
 * Fonte: https://gbdev.io/pandocs/OAM_DMA_Transfer.html
 */
export class OamDma {
  private source = 0
  private pendingSource = 0
  private startupTCycles = 0
  private byteTCycles = 0
  private index = 0
  private transferring = false
  private register = 0xff

  constructor(
    private readonly readSource: (address: number) => number,
    private readonly writeOam: (address: number, value: number) => void,
  ) {}

  get active(): boolean {
    return this.transferring
  }

  get pending(): boolean {
    return this.startupTCycles !== 0
  }

  get bytesTransferred(): number {
    return this.index
  }

  snapshotState(): OamDmaState {
    return {
      version: 1,
      source: this.source,
      pendingSource: this.pendingSource,
      startupTCycles: this.startupTCycles,
      byteTCycles: this.byteTCycles,
      index: this.index,
      transferring: this.transferring,
      register: this.register,
    }
  }

  /** Restaura a latência e a origem ativa sem ler a fonte nem escrever OAM. */
  restoreState(value: unknown): void {
    const state = stateRecord(value, 'dma')
    const valid: OamDmaState = {
      version: stateInteger(state.version, 1, 1, 'dma.version') as 1,
      source: stateInteger(state.source, 0, 0xdf00, 'dma.source'),
      pendingSource: stateInteger(state.pendingSource, 0, 0xdf00, 'dma.pendingSource'),
      startupTCycles: stateInteger(state.startupTCycles, 0, 8, 'dma.startupTCycles'),
      byteTCycles: stateInteger(state.byteTCycles, 0, 3, 'dma.byteTCycles'),
      index: stateInteger(state.index, 0, 160, 'dma.index'),
      transferring: stateBoolean(state.transferring, 'dma.transferring'),
      register: stateInteger(state.register, 0, 0xff, 'dma.register'),
    }
    if ((valid.source & 0xff) !== 0 || (valid.pendingSource & 0xff) !== 0) {
      throw new Error('Estado inválido: a origem do DMA deve estar alinhada em 256 bytes.')
    }
    if (valid.transferring ? valid.index === 160 : valid.index !== 0 && valid.index !== 160) {
      throw new Error('Estado inválido: índice do DMA incompatível com transferência ativa.')
    }
    if (!valid.transferring && valid.byteTCycles !== 0) {
      throw new Error('Estado inválido: DMA inativo não pode ter cópia parcial de byte.')
    }
    if (valid.startupTCycles === 0 && valid.source !== valid.pendingSource) {
      throw new Error('Estado inválido: origem pendente do DMA sem latência de início.')
    }
    const expectedSource = (valid.register >= 0xe0 ? valid.register - 0x20 : valid.register) << 8
    const initial =
      valid.register === 0xff &&
      valid.source === 0 &&
      valid.pendingSource === 0 &&
      valid.startupTCycles === 0 &&
      valid.byteTCycles === 0 &&
      valid.index === 0 &&
      !valid.transferring
    if (valid.pendingSource !== expectedSource && !initial) {
      throw new Error('Estado inválido: registrador do DMA diverge da origem pendente.')
    }
    this.source = valid.source
    this.pendingSource = valid.pendingSource
    this.startupTCycles = valid.startupTCycles
    this.byteTCycles = valid.byteTCycles
    this.index = valid.index
    this.transferring = valid.transferring
    this.register = valid.register
  }

  /**
   * VRAM possui barramento separado do principal também no DMG. O bloqueio
   * acompanha a origem ativa, preservada durante a espera de um reinício.
   * A separação é observada nos testes de timing Mooneye verificados em hardware
   * e modelada em is_addr_in_dma_use do SameBoy, Core/memory.c.
   */
  blocksCpuAddress(address: number): boolean {
    const normalized = address & 0xffff
    if (!this.transferring || normalized >= 0xff80 || normalized === 0xff46) return false
    if (normalized >= 0xfe00) return true
    const sourceUsesVramBus = this.source >= 0x8000 && this.source < 0xa000
    const cpuUsesVramBus = normalized >= 0x8000 && normalized < 0xa000
    return sourceUsesVramBus === cpuUsesVramBus
  }

  readRegister(): number {
    return this.register
  }

  start(value: number): void {
    this.register = value & 0xff
    // E000-FFFF usa o mesmo barramento de origem que C000-DFFF no DMG.
    this.pendingSource = (this.register >= 0xe0 ? this.register - 0x20 : this.register) << 8
    this.startupTCycles = 8
  }

  tick(tCycles: number): void {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0) {
      throw new Error('O DMA exige uma quantidade inteira e não negativa de T-cycles.')
    }
    for (let elapsed = 0; elapsed < tCycles; elapsed += 1) {
      if (this.transferring) {
        this.byteTCycles += 1
        if (this.byteTCycles === 4) {
          this.byteTCycles = 0
          this.writeOam(0xfe00 | this.index, this.readSource(this.source | this.index))
          this.index += 1
          if (this.index === 160) this.transferring = false
        }
      }
      if (this.startupTCycles > 0) {
        this.startupTCycles -= 1
        if (this.startupTCycles === 0) {
          this.source = this.pendingSource
          this.index = 0
          this.byteTCycles = 0
          this.transferring = true
        }
      }
    }
  }
}
