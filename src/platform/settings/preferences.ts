import { DEFAULT_KEYBOARD_BINDINGS, validateKeyboardBindings } from '../input/controller'
import type { KeyboardBindings } from '../input/controller'

export type PaletteId = 'dmg' | 'pocket' | 'light'
export interface Preferences {
  version: 1
  paletteId: PaletteId
  volume: number
  muted: boolean
  keyboardBindings: KeyboardBindings
}
export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export const PREFERENCES_KEY = 'pocketlab.preferences'

export function defaultPreferences(): Preferences {
  return {
    version: 1,
    paletteId: 'dmg',
    volume: 0.5,
    muted: false,
    keyboardBindings: validateKeyboardBindings(DEFAULT_KEYBOARD_BINDINGS),
  }
}

function validatePreferences(value: unknown): Preferences {
  if (value === null || typeof value !== 'object') throw new Error('Preferências inválidas.')
  const saved = value as Record<string, unknown>
  if (
    saved.version !== 1 ||
    !['dmg', 'pocket', 'light'].includes(saved.paletteId as string) ||
    typeof saved.volume !== 'number' ||
    !Number.isFinite(saved.volume) ||
    saved.volume < 0 ||
    saved.volume > 1 ||
    typeof saved.muted !== 'boolean'
  )
    throw new Error('Preferências inválidas.')
  return {
    version: 1,
    paletteId: saved.paletteId as PaletteId,
    volume: saved.volume,
    muted: saved.muted,
    keyboardBindings: validateKeyboardBindings(saved.keyboardBindings),
  }
}

export function loadPreferences(storage?: PreferenceStorage): {
  preferences: Preferences
  notice: string
} {
  try {
    const source = storage ?? globalThis.localStorage
    const saved = source.getItem(PREFERENCES_KEY)
    return {
      preferences: saved === null ? defaultPreferences() : validatePreferences(JSON.parse(saved)),
      notice: '',
    }
  } catch {
    return {
      preferences: defaultPreferences(),
      notice: 'Suas preferências locais não puderam ser recuperadas. Usamos o padrão nesta sessão.',
    }
  }
}

export function savePreferences(preferences: Preferences, storage?: PreferenceStorage): string {
  try {
    const target = storage ?? globalThis.localStorage
    target.setItem(PREFERENCES_KEY, JSON.stringify(validatePreferences(preferences)))
    return ''
  } catch {
    return 'O navegador não permitiu guardar as preferências. Seus ajustes funcionam nesta sessão.'
  }
}
