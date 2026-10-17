function blocksRewind(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return (
    element?.nodeType === 1 &&
    (element.isContentEditable ||
      element.closest(
        'input, textarea, select, button, a[href], summary, details, dialog, [contenteditable], [role="textbox"], [role="button"], [role="dialog"], [role="menu"], [role="menuitem"], [role="listbox"], [role="slider"], [role="spinbutton"], [data-rewind-shortcut-blocked]',
      ) !== null)
  )
}

export function bindRewindShortcut(
  target: Window,
  enabled: () => boolean,
  onBegin: () => void,
  onEnd: (resume: boolean) => void,
  isReserved: () => boolean = () => false,
): () => void {
  let held = false
  let disposed = false
  const end = (resume: boolean): void => {
    if (!held) return
    held = false
    onEnd(resume)
  }
  const keydown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') {
      end(false)
      return
    }
    if (
      event.code !== 'KeyR' ||
      !enabled() ||
      isReserved() ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      target.document.hidden ||
      !target.document.hasFocus() ||
      blocksRewind(event.target) ||
      target.document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') !== null
    ) {
      return
    }
    event.preventDefault()
    if (held || event.repeat) return
    held = true
    onBegin()
  }
  const keyup = (event: KeyboardEvent): void => {
    // Soltar R libera sua fonte mesmo após mudança de foco, mapa ou sessão.
    if (event.code !== 'KeyR' || !held) return
    event.preventDefault()
    end(true)
  }
  const blur = (): void => end(false)
  const visibilitychange = (): void => {
    if (target.document.hidden) end(false)
  }
  const focusin = (event: FocusEvent): void => {
    if (blocksRewind(event.target)) end(false)
  }

  target.addEventListener('keydown', keydown)
  target.addEventListener('keyup', keyup)
  target.addEventListener('blur', blur)
  target.addEventListener('focusin', focusin)
  target.document.addEventListener('visibilitychange', visibilitychange)
  return () => {
    if (disposed) return
    disposed = true
    target.removeEventListener('keydown', keydown)
    target.removeEventListener('keyup', keyup)
    target.removeEventListener('blur', blur)
    target.removeEventListener('focusin', focusin)
    target.document.removeEventListener('visibilitychange', visibilitychange)
    end(false)
  }
}
