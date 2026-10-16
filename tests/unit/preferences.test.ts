import { describe, expect, it } from 'vitest'
import {
  defaultPreferences,
  loadPreferences,
  savePreferences,
  PREFERENCES_KEY,
} from '../../src/platform/settings/preferences'
import type { PreferenceStorage } from '../../src/platform/settings/preferences'

function storage(): PreferenceStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('preferências locais', () => {
  it('mantém paleta, volume e teclado ao abrir outra sessão', () => {
    const local = storage()
    const preferences = defaultPreferences()
    preferences.paletteId = 'light'
    preferences.volume = 0.23
    preferences.muted = true
    preferences.keyboardBindings.a = ['KeyC']
    expect(savePreferences(preferences, local)).toBe('')
    expect(loadPreferences(local)).toEqual({ preferences, notice: '' })
  })

  it('retorna cópias independentes dos atalhos padrão', () => {
    const first = defaultPreferences()
    first.keyboardBindings.a[0] = 'KeyQ'
    expect(defaultPreferences().keyboardBindings.a).toEqual(['KeyZ'])
  })

  it.each([
    'arquivo quebrado',
    JSON.stringify({ ...defaultPreferences(), version: 2 }),
    JSON.stringify({ ...defaultPreferences(), volume: 1.5 }),
    JSON.stringify({ ...defaultPreferences(), paletteId: 'unknown' }),
    JSON.stringify({ ...defaultPreferences(), keyboardBindings: { a: ['KeyA'] } }),
  ])('recupera padrão quando o registro é incompatível ou inválido', (value) => {
    const local = storage()
    local.setItem(PREFERENCES_KEY, value)
    const loaded = loadPreferences(local)
    expect(loaded.preferences).toEqual(defaultPreferences())
    expect(loaded.notice).toContain('não puderam ser recuperadas')
  })

  it('mantém ajustes utilizáveis quando o navegador bloqueia armazenamento', () => {
    const denied: PreferenceStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(loadPreferences(denied).preferences).toEqual(defaultPreferences())
    expect(savePreferences(defaultPreferences(), denied)).toContain('funcionam nesta sessão')
  })
})
