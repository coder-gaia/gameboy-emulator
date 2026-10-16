import { describe, expect, it, vi } from 'vitest'
import { InputController } from '../../src/platform/input/controller'
import type { InputButton } from '../../src/platform/input/controller'
import { bindGamepads, readAxisDirection } from '../../src/platform/input/gamepad'
import type { GamepadStatus } from '../../src/platform/input/gamepad'

function createPad(index = 0, id = `Controle ${index}`) {
  return {
    index,
    id,
    connected: true,
    mapping: 'standard',
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  }
}

function setup() {
  const calls: [InputButton, boolean][] = []
  const controller = new InputController((button, pressed) => calls.push([button, pressed]))
  const statuses: GamepadStatus[] = []
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    focused: true,
    hasFocus: () => document.focused,
  })
  let pads: (ReturnType<typeof createPad> | null)[] = []
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  const navigator: { getGamepads?: () => (Gamepad | null)[] } = {
    getGamepads: vi.fn(() => pads as unknown as (Gamepad | null)[]),
  }
  const target = Object.assign(new EventTarget(), {
    document,
    navigator,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++
      callbacks.set(id, callback)
      return id
    }),
    cancelAnimationFrame: vi.fn((id: number) => callbacks.delete(id)),
  })
  let enabled = true
  return {
    controller,
    calls,
    statuses,
    document,
    target,
    navigator,
    callbacks,
    setPads: (value: typeof pads) => (pads = value),
    setEnabled: (value: boolean) => (enabled = value),
    bind: () =>
      bindGamepads(
        controller,
        target as unknown as Window,
        () => enabled,
        (status) => statuses.push(status),
      ),
    tick: () => {
      const current = [...callbacks.values()]
      callbacks.clear()
      for (const callback of current) callback(0)
    },
    event: (
      type: 'gamepadconnected' | 'gamepaddisconnected',
      pad: ReturnType<typeof createPad>,
    ) => {
      target.dispatchEvent(Object.assign(new Event(type), { gamepad: pad }))
    },
  }
}

describe('zona neutra e histerese dos eixos', () => {
  it('exige 0,55 para pressionar e solta ao voltar a 0,35', () => {
    expect(readAxisDirection(0.54, 0)).toBe(0)
    expect(readAxisDirection(0.55, 0)).toBe(1)
    expect(readAxisDirection(0.4, 1)).toBe(1)
    expect(readAxisDirection(0.35, 1)).toBe(0)
    expect(readAxisDirection(-0.54, 0)).toBe(0)
    expect(readAxisDirection(-0.55, 0)).toBe(-1)
    expect(readAxisDirection(-0.4, -1)).toBe(-1)
    expect(readAxisDirection(-0.35, -1)).toBe(0)
  })

  it('troca diretamente de direção e rejeita leituras ausentes ou não finitas', () => {
    expect(readAxisDirection(-0.9, 1)).toBe(-1)
    expect(readAxisDirection(0.9, -1)).toBe(1)
    expect(readAxisDirection(0.4, -1)).toBe(0)
    for (const value of [undefined, NaN, Infinity, -Infinity]) {
      expect(readAxisDirection(value, 1)).toBe(0)
    }
  })
})

describe('controles com mapeamento padrão', () => {
  it.each([
    [0, 'a'],
    [1, 'b'],
    [8, 'select'],
    [9, 'start'],
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
  ] as const)('mapeia botão %i para %s, sem repetir pressões a cada frame', (index, button) => {
    const fake = setup()
    const pad = createPad()
    pad.buttons[index]!.pressed = true
    fake.setPads([pad])
    const cleanup = fake.bind()
    fake.tick()
    fake.tick()
    expect(fake.calls).toEqual([[button, true]])
    pad.buttons[index]!.pressed = false
    fake.tick()
    expect(fake.calls.at(-1)).toEqual([button, false])
    cleanup()
  })

  it('usa valor analógico de botão e ignora botões sem ação', () => {
    const fake = setup()
    const pad = createPad()
    pad.buttons[0]!.value = 0.5
    pad.buttons[2]!.pressed = true
    fake.setPads([pad])
    const cleanup = fake.bind()
    expect(fake.calls).toEqual([['a', true]])
    pad.buttons[0]!.value = 0.49
    fake.tick()
    expect(fake.calls.at(-1)).toEqual(['a', false])
    cleanup()
  })

  it('lê os dois eixos e preserva o direcional quando o analógico volta ao centro', () => {
    const fake = setup()
    const pad = createPad()
    pad.axes = [0.8, -0.8]
    pad.buttons[15]!.pressed = true
    fake.setPads([pad])
    const cleanup = fake.bind()
    expect(fake.controller.getSnapshot()).toBe(5)
    pad.axes = [0, 0]
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(1)
    pad.buttons[15]!.pressed = false
    pad.axes = [-0.8, 0.8]
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(10)
    pad.axes = [-0.4, 0.4]
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(10)
    pad.axes = [-0.35, 0.35]
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(0)
    cleanup()
  })

  it('ignora controles não padrão e fornece instrução útil', () => {
    const fake = setup()
    const pad = createPad()
    pad.mapping = ''
    pad.buttons[0]!.pressed = true
    fake.setPads([pad])
    const cleanup = fake.bind()
    expect(fake.calls).toEqual([])
    expect(fake.statuses.at(-1)).toMatchObject({ supported: true, connectedCount: 0 })
    expect(fake.statuses.at(-1)?.message).toContain('não tem mapeamento padrão')
    cleanup()
  })

  it('informa conexão e desconexão, sem repetir status inalterado', () => {
    const fake = setup()
    const cleanup = fake.bind()
    expect(fake.statuses.at(-1)?.connectedCount).toBe(0)
    const pad = createPad()
    fake.setPads([pad])
    fake.event('gamepadconnected', pad)
    expect(fake.statuses.at(-1)?.connectedCount).toBe(1)
    fake.tick()
    fake.tick()
    expect(fake.statuses).toHaveLength(2)
    fake.setPads([])
    fake.event('gamepaddisconnected', pad)
    expect(fake.statuses.at(-1)?.connectedCount).toBe(0)
    expect(fake.statuses).toHaveLength(3)
    cleanup()
  })

  it('solta a desconexão imediatamente mesmo com a última leitura ainda exposta', () => {
    const fake = setup()
    const pad = createPad()
    pad.buttons[0]!.pressed = true
    fake.setPads([pad])
    const cleanup = fake.bind()
    fake.event('gamepaddisconnected', pad)
    expect(fake.controller.getSnapshot()).toBe(0)
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(0)
    expect(fake.statuses.at(-1)?.connectedCount).toBe(0)
    fake.event('gamepadconnected', pad)
    expect(fake.controller.getSnapshot()).toBe(16)
    cleanup()
  })

  it('solta pad ausente no polling, mesmo se o evento de desconexão não chegar', () => {
    const fake = setup()
    const pad = createPad()
    pad.buttons[0]!.pressed = true
    fake.setPads([null, pad])
    const cleanup = fake.bind()
    fake.setPads([null])
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(0)
    expect(fake.statuses.at(-1)?.connectedCount).toBe(0)
    cleanup()
  })

  it('preserva outro pad, teclado e toque ao desconectar um controle', () => {
    const fake = setup()
    const pad0 = createPad(0)
    const pad1 = createPad(1)
    pad0.buttons[0]!.pressed = true
    pad1.buttons[0]!.pressed = true
    fake.controller.press('a', 'keyboard:KeyZ')
    fake.controller.press('right', 'pointer:1')
    fake.setPads([pad0, pad1])
    const cleanup = fake.bind()
    fake.setPads([null, pad1])
    fake.event('gamepaddisconnected', pad0)
    fake.controller.release('keyboard:KeyZ')
    expect(fake.controller.getSnapshot()).toBe(17)
    fake.setPads([])
    fake.event('gamepaddisconnected', pad1)
    expect(fake.controller.getSnapshot()).toBe(1)
    expect(fake.statuses.some((status) => status.connectedCount === 2)).toBe(true)
    cleanup()
  })

  it('libera fontes antigas se outro dispositivo reutilizar o mesmo índice', () => {
    const fake = setup()
    const oldPad = createPad(0, 'Antigo')
    oldPad.buttons[0]!.pressed = true
    fake.setPads([oldPad])
    const cleanup = fake.bind()
    const replacement = createPad(0, 'Novo')
    replacement.buttons[1]!.pressed = true
    fake.setPads([replacement])
    fake.tick()
    expect(fake.calls).toEqual([
      ['a', true],
      ['a', false],
      ['b', true],
    ])
    cleanup()
  })

  it.each(['pause', 'blur', 'hidden', 'focus', 'cleanup'])(
    'libera apenas gamepad ao ocorrer %s',
    (reason) => {
      const fake = setup()
      const pad = createPad()
      pad.buttons[0]!.pressed = true
      pad.axes[0] = 0.9
      fake.controller.press('a', 'keyboard:KeyZ')
      fake.controller.press('down', 'pointer:1')
      fake.setPads([pad])
      const cleanup = fake.bind()
      expect(fake.controller.getSnapshot()).toBe(25)
      if (reason === 'pause') fake.setEnabled(false)
      else if (reason === 'blur') fake.target.dispatchEvent(new Event('blur'))
      else if (reason === 'hidden') {
        fake.document.hidden = true
        fake.document.dispatchEvent(new Event('visibilitychange'))
      } else if (reason === 'focus') fake.document.focused = false
      else cleanup()
      fake.tick()
      expect(fake.controller.getSnapshot()).toBe(24)
      fake.controller.release('keyboard:KeyZ')
      expect(fake.controller.getSnapshot()).toBe(8)
      cleanup()
    },
  )

  it('aguarda em pausa e retoma a leitura ao recuperar foco e visibilidade', () => {
    const fake = setup()
    const pad = createPad()
    pad.buttons[0]!.pressed = true
    fake.setPads([pad])
    fake.setEnabled(false)
    const cleanup = fake.bind()
    expect(fake.controller.getSnapshot()).toBe(0)
    fake.setEnabled(true)
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(16)
    fake.target.dispatchEvent(new Event('blur'))
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(0)
    fake.target.dispatchEvent(new Event('focus'))
    expect(fake.controller.getSnapshot()).toBe(16)
    fake.document.hidden = true
    fake.document.dispatchEvent(new Event('visibilitychange'))
    expect(fake.controller.getSnapshot()).toBe(0)
    fake.document.hidden = false
    fake.document.dispatchEvent(new Event('visibilitychange'))
    expect(fake.controller.getSnapshot()).toBe(16)
    cleanup()
  })

  it('não reinicia o analógico entre 0,35 e 0,55 depois de uma pausa', () => {
    const fake = setup()
    const pad = createPad()
    pad.axes[0] = 0.8
    fake.setPads([pad])
    const cleanup = fake.bind()
    pad.axes[0] = 0.4
    fake.setEnabled(false)
    fake.tick()
    fake.setEnabled(true)
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(0)
    cleanup()
  })

  it('encerra eventos e polling sem liberar fontes de outros dispositivos', () => {
    const fake = setup()
    const pad = createPad()
    pad.buttons[0]!.pressed = true
    fake.setPads([pad])
    fake.controller.press('b', 'keyboard:KeyX')
    const cleanup = fake.bind()
    cleanup()
    cleanup()
    expect(fake.callbacks.size).toBe(0)
    expect(fake.target.cancelAnimationFrame).toHaveBeenCalledOnce()
    expect(fake.controller.getSnapshot()).toBe(32)
    fake.event('gamepadconnected', pad)
    fake.target.dispatchEvent(new Event('focus'))
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(32)
  })

  it('funciona sem a API e explica o fallback sem iniciar polling', () => {
    const fake = setup()
    delete fake.navigator.getGamepads
    const cleanup = fake.bind()
    expect(fake.statuses).toEqual([
      {
        supported: false,
        connectedCount: 0,
        message: 'Este navegador não oferece suporte a controles USB ou Bluetooth.',
      },
    ])
    expect(fake.callbacks.size).toBe(0)
    cleanup()
  })

  it('recupera de bloqueio de acesso à API sem manter botões presos', () => {
    const fake = setup()
    const pad = createPad()
    pad.buttons[0]!.pressed = true
    fake.setPads([pad])
    const cleanup = fake.bind()
    const original = fake.navigator.getGamepads
    fake.navigator.getGamepads = () => {
      throw new Error('SecurityError')
    }
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(0)
    expect(fake.statuses.at(-1)?.supported).toBe(false)
    fake.navigator.getGamepads = original
    fake.tick()
    expect(fake.controller.getSnapshot()).toBe(16)
    expect(fake.statuses.at(-1)?.supported).toBe(true)
    cleanup()
  })
})
