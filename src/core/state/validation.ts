/** Validadores de estados externos. Nunca normalizam silenciosamente valores inválidos. */
export function stateRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Estado inválido: ${label} deve ser um objeto.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Estado inválido: ${label} deve ser um objeto simples.`)
  }
  return value as Record<string, unknown>
}

export function stateInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Estado inválido: ${label} deve ser um inteiro entre ${min} e ${max}.`)
  }
  return value
}

export function stateBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Estado inválido: ${label} deve ser booleano.`)
  }
  return value
}

export function stateBytes(value: unknown, length: number, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`Estado inválido: ${label} deve conter ${length} bytes.`)
  }
  return Uint8Array.from(value)
}

export function stateNumber(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Estado inválido: ${label} deve ser finito e estar entre ${min} e ${max}.`)
  }
  return value
}
