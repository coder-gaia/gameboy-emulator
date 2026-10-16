import { describe, expect, it, vi } from 'vitest'
import { BatterySession } from '../../src/runtime/battery-session'
import type { BatteryMemory } from '../../src/runtime/battery-session'

function memory(): BatteryMemory & { bytes: Uint8Array; batteryRevision: number } {
  return {
    bytes: new Uint8Array(2),
    batteryRevision: 0,
    exportBatteryRam() {
      return this.bytes.slice()
    },
    importBatteryRam(bytes) {
      this.bytes.set(bytes)
      this.batteryRevision += 1
    },
  }
}

describe('sessão de bateria', () => {
  it('restaura antes de salvar e não regrava dados que não mudaram', async () => {
    const cartridge = memory()
    const storage = {
      loadBattery: vi.fn().mockResolvedValue(new Uint8Array([7, 8])),
      saveBattery: vi.fn().mockResolvedValue(undefined),
    }
    const session = new BatterySession(storage, 'rom-a', cartridge)
    expect(await session.restore()).toBe(true)
    expect(cartridge.bytes).toEqual(new Uint8Array([7, 8]))
    await session.flush()
    expect(storage.saveBattery).not.toHaveBeenCalled()
    cartridge.bytes[0] = 9
    cartridge.batteryRevision += 1
    await session.flush()
    expect(storage.saveBattery).toHaveBeenCalledWith('rom-a', new Uint8Array([9, 8]))
  })

  it('preserva um save incompatível sem sobrescrevê-lo após falha de leitura', async () => {
    const cartridge = memory()
    const storage = {
      loadBattery: vi.fn().mockRejectedValue(new Error('Dados incompatíveis')),
      saveBattery: vi.fn(),
    }
    const session = new BatterySession(storage, 'rom-a', cartridge)
    await expect(session.restore()).rejects.toThrow('incompatíveis')
    cartridge.batteryRevision += 1
    await session.flush()
    expect(storage.saveBattery).not.toHaveBeenCalled()
  })

  it('serializa snapshots e não deixa uma gravação antiga vencer a nova', async () => {
    const cartridge = memory()
    const stored: number[] = []
    const storage = {
      loadBattery: vi.fn().mockResolvedValue(null),
      saveBattery: vi.fn(async (_id: string, bytes: Uint8Array) => {
        await Promise.resolve()
        stored.push(bytes[0]!)
      }),
    }
    const session = new BatterySession(storage, 'rom-a', cartridge)
    await session.restore()
    cartridge.bytes[0] = 1
    cartridge.batteryRevision += 1
    const first = session.flush()
    cartridge.bytes[0] = 2
    cartridge.batteryRevision += 1
    const second = session.flush()
    await Promise.all([first, second])
    expect(stored).toEqual([1, 2])
    await session.flush()
    expect(stored).toHaveLength(2)
  })

  it('permite tentar novamente após falha de gravação sem perder o snapshot atual', async () => {
    const cartridge = memory()
    const storage = {
      loadBattery: vi.fn().mockResolvedValue(null),
      saveBattery: vi
        .fn()
        .mockRejectedValueOnce(new Error('Sem espaço'))
        .mockResolvedValue(undefined),
    }
    const session = new BatterySession(storage, 'rom-a', cartridge)
    await session.restore()
    cartridge.bytes[0] = 3
    cartridge.batteryRevision += 1
    await expect(session.flush()).rejects.toThrow('Sem espaço')
    await session.flush()
    expect(storage.saveBattery).toHaveBeenCalledTimes(2)
  })
})
