const COUNTER_BITS = [9, 3, 5, 7] as const

/**
 * Timer DMG por bordas de descida do contador de 16 bits.
 * O atraso de overflow e a janela de reload usam T-cycles, nunca frames.
 * Fonte: https://gbdev.io/pandocs/Timer_Obscure_Behaviour.html
 */
export class Timer {
  private divider = 0
  private counter = 0
  private modulo = 0
  private control = 0
  private reloadDelay = 0
  private reloadWindow = 0

  get systemCounter(): number {
    return this.divider
  }

  read8(address: number): number {
    switch (address) {
      case 0xff04:
        return this.divider >>> 8
      case 0xff05:
        return this.counter
      case 0xff06:
        return this.modulo
      case 0xff07:
        return this.control | 0xf8
      default:
        return 0xff
    }
  }

  write8(address: number, value: number): void {
    const byte = value & 0xff
    switch (address) {
      case 0xff04:
        this.resetDivider()
        break
      case 0xff05:
        // Na janela B, o carregamento de TMA prevalece sobre a CPU.
        if (this.reloadWindow !== 0) return
        this.counter = byte
        this.reloadDelay = 0
        break
      case 0xff06:
        this.modulo = byte
        if (this.reloadWindow !== 0) this.counter = byte
        break
      case 0xff07: {
        const previous = this.timerSignal()
        this.control = byte & 7
        if (previous && !this.timerSignal()) this.increment()
        break
      }
    }
  }

  resetDivider(): void {
    const previous = this.timerSignal()
    this.divider = 0
    if (previous) this.increment()
  }

  /** Retorna true se houve um pedido de IRQ de timer neste intervalo. */
  tick(tCycles: number): boolean {
    if (!Number.isSafeInteger(tCycles) || tCycles < 0) {
      throw new Error('O timer exige uma quantidade inteira e não negativa de T-cycles.')
    }
    let interrupt = false
    for (let elapsed = 0; elapsed < tCycles; elapsed += 1) {
      if (this.reloadWindow > 0) this.reloadWindow -= 1
      if (this.reloadDelay > 0) {
        this.reloadDelay -= 1
        if (this.reloadDelay === 0) {
          this.counter = this.modulo
          this.reloadWindow = 4
          interrupt = true
        }
      }
      const previous = this.timerSignal()
      this.divider = (this.divider + 1) & 0xffff
      if (previous && !this.timerSignal()) this.increment()
    }
    return interrupt
  }

  private timerSignal(): boolean {
    return (this.control & 4) !== 0 && (this.divider & (1 << COUNTER_BITS[this.control & 3]!)) !== 0
  }

  private increment(): void {
    if (this.reloadDelay !== 0 || this.reloadWindow !== 0) return
    this.counter = (this.counter + 1) & 0xff
    if (this.counter === 0) this.reloadDelay = 4
  }
}
