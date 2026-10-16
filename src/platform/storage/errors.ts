export type BatteryStorageErrorCode =
  | 'unavailable'
  | 'blocked'
  | 'timeout'
  | 'closed'
  | 'quota-exceeded'
  | 'invalid-data'
  | 'incompatible-data'
  | 'operation-failed'

export class BatteryStorageError extends Error {
  constructor(
    readonly code: BatteryStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BatteryStorageError'
  }
}

export function storageFailure(action: string, cause: unknown): BatteryStorageError {
  if (cause instanceof BatteryStorageError) return cause
  const name =
    cause !== null && typeof cause === 'object' && 'name' in cause ? cause.name : undefined
  if (name === 'QuotaExceededError') {
    return new BatteryStorageError(
      'quota-exceeded',
      'O armazenamento local está cheio. O progresso desta sessão ainda não foi salvo.',
      { cause },
    )
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return new BatteryStorageError(
      'unavailable',
      'Este navegador não permitiu acessar os saves locais. O progresso desta sessão não será salvo.',
      { cause },
    )
  }
  if (name === 'VersionError') {
    return new BatteryStorageError(
      'incompatible-data',
      'O armazenamento pertence a uma versão mais recente do projeto. Recarregue a página para continuar.',
      { cause },
    )
  }
  return new BatteryStorageError('operation-failed', `Não foi possível ${action}.`, { cause })
}
