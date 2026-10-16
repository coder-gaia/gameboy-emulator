import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  validateKeyboardBindings,
  DEFAULT_KEYBOARD_BINDINGS,
} from '../../platform/input/controller'
import type { InputButton, KeyboardBindings } from '../../platform/input/controller'
import type { GamepadStatus } from '../../platform/input/gamepad'
import { keyLabel } from '../../platform/input/key-label'
import styles from './PreferencesPanel.module.css'

const actions: { button: InputButton; label: string }[] = [
  { button: 'up', label: 'Cima' },
  { button: 'down', label: 'Baixo' },
  { button: 'left', label: 'Esquerda' },
  { button: 'right', label: 'Direita' },
  { button: 'a', label: 'Botão A' },
  { button: 'b', label: 'Botão B' },
  { button: 'start', label: 'Start' },
  { button: 'select', label: 'Select' },
]

export function PreferencesPanel({
  bindings,
  onBindingsChange,
  onOpen,
  gamepad,
  notice,
}: {
  bindings: KeyboardBindings
  onBindingsChange: (bindings: KeyboardBindings) => void
  onOpen: () => void
  gamepad: GamepadStatus
  notice: string
}) {
  const [mappingNotice, setMappingNotice] = useState('')

  function remap(button: InputButton, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Tab') return
    if (event.key === 'Escape') {
      event.currentTarget.blur()
      return
    }
    event.preventDefault()
    if (event.repeat) return
    if (event.ctrlKey || event.metaKey || event.altKey) {
      setMappingNotice('Escolha uma tecla sem Ctrl, Alt ou Command.')
      return
    }
    try {
      const changed = validateKeyboardBindings({ ...bindings, [button]: [event.code] })
      onBindingsChange(changed)
      setMappingNotice('Tecla atualizada. Clique na tela e use Iniciar para jogar.')
    } catch (cause) {
      setMappingNotice(cause instanceof Error ? cause.message : 'Esta tecla não está disponível.')
    }
  }

  return (
    <details
      className={styles.panel}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen()
      }}
    >
      <summary>Controles e preferências</summary>
      <p className={styles.explanation}>
        Clique em uma tecla e pressione a substituta. Tab navega entre campos; Esc sai do campo. Não
        é possível usar a mesma tecla em dois comandos.
      </p>
      <div className={styles.bindings}>
        {actions.map(({ button, label }) => (
          <label key={button}>
            <span>{label}</span>
            <input
              type="text"
              readOnly
              value={bindings[button].map(keyLabel).join(' / ')}
              aria-label={`Tecla para ${label}`}
              onKeyDown={(event) => remap(button, event)}
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onBindingsChange(validateKeyboardBindings(DEFAULT_KEYBOARD_BINDINGS))
          setMappingNotice('Teclado padrão restaurado.')
        }}
      >
        Restaurar teclado padrão
      </button>
      {mappingNotice && (
        <p role="status" aria-label="Configuração do teclado">
          {mappingNotice}
        </p>
      )}
      <p className={styles.gamepad} role="status" aria-label="Estado do gamepad">
        {gamepad.message}
      </p>
      <p className={styles.explanation}>
        Em um controle padrão, use o direcional ou analógico esquerdo. Os dois botões inferiores
        correspondem a A e B; os botões centrais, a Select e Start. Pressione um botão para o
        navegador reconhecer a conexão. Teclado, toque e controle podem ser usados juntos.
      </p>
      <p className={styles.explanation}>
        Paleta, volume e teclado ficam guardados neste navegador. O som sempre precisa da sua
        ativação ao abrir a página.
      </p>
      {notice && (
        <p role="status" aria-label="Estado das preferências">
          {notice}
        </p>
      )}
    </details>
  )
}
