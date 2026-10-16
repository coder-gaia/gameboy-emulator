import { sha256 } from '@noble/hashes/sha2.js'
import { storageFailure } from './errors'

/** Identifica o conteúdo completo do cartucho, independentemente do nome do arquivo. */
export async function hashRom(
  rom: Uint8Array,
  subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle,
): Promise<string> {
  try {
    // Uma cópia também suporta views com offset e buffers compartilhados.
    const copy = new Uint8Array(rom)
    // HTTP na rede local não oferece SubtleCrypto. O algoritmo continua SHA-256.
    const digest = subtle ? new Uint8Array(await subtle.digest('SHA-256', copy)) : sha256(copy)
    let hexadecimal = ''
    for (const byte of digest) hexadecimal += byte.toString(16).padStart(2, '0')
    return hexadecimal
  } catch (cause) {
    throw storageFailure('identificar o cartucho para acessar seus saves', cause)
  }
}
