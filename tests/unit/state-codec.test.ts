import { describe, expect, it } from 'vitest'
import {
  createStateRecord,
  decodeState,
  encodeState,
  MAX_STATE_BYTES,
  StateFileError,
} from '../../src/platform/states'
import type { StateRecord } from '../../src/platform/states'

const ROM_A = 'a'.repeat(64)
const ROM_B = 'b'.repeat(64)
const encodeJson = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

async function encoded() {
  const record = await createStateRecord(
    ROM_A,
    1,
    {
      core: { ram: new Uint8Array([0, 127, 255]), counters: [12, 34], enabled: true },
      serial: 'OK\n',
    },
    1234,
  )
  return { record, bytes: await encodeState(record) }
}

describe('codec de estados Pocket Lab', () => {
  it('exporta e importa JSON versionado com bytes, arrays, booleanos e texto preservados', async () => {
    const { record, bytes } = await encoded()
    const restored = await decodeState(bytes, ROM_A)
    expect(restored).toEqual(record)
    expect((restored.payload as { core: { ram: unknown } }).core.ram).toBeInstanceOf(Uint8Array)
    expect(restored).toMatchObject({
      format: 'PocketLab',
      version: 1,
      model: 'DMG-CPU-B',
      slot: 1,
      createdAt: 1234,
    })
    expect(bytes.byteLength).toBeLessThan(MAX_STATE_BYTES)
  })

  it('captura payload antes de aguardar SHA e não compartilha o buffer com o chamador', async () => {
    const payload = { ram: new Uint8Array([1, 2]), serial: 'A' }
    const creating = createStateRecord(ROM_A, 1, payload, 1234)
    payload.ram.fill(9)
    payload.serial = 'B'
    const record = await creating
    expect(record.payload).toEqual({ ram: new Uint8Array([1, 2]), serial: 'A' })
    const bytes = await encodeState(record)
    const loaded = await decodeState(bytes)
    ;(loaded.payload as { ram: Uint8Array }).ram.fill(8)
    expect((await decodeState(bytes)).payload).toEqual({ ram: new Uint8Array([1, 2]), serial: 'A' })
  })

  it('ordem das propriedades e formatação do arquivo não mudam o checksum do conteúdo', async () => {
    const first = await createStateRecord(ROM_A, 1, { b: 2, a: { y: 4, x: 3 } }, 1234)
    const second = await createStateRecord(ROM_A, 1, { a: { x: 3, y: 4 }, b: 2 }, 1234)
    expect(first.checksum).toBe(second.checksum)
    const formatted = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(await encodeState(first))), null, 2),
    )
    expect(await decodeState(formatted)).toEqual(first)
  })

  it('modificar um byte do payload ou um metadado é detectado antes de devolver o estado', async () => {
    const { bytes } = await encoded()
    const payloadChanged = JSON.parse(new TextDecoder().decode(bytes))
    payloadChanged.payload.core.ram.data[0] = 1
    await expect(decodeState(encodeJson(payloadChanged))).rejects.toMatchObject({
      code: 'checksum-mismatch',
    })
    const metadataChanged = JSON.parse(new TextDecoder().decode(bytes))
    metadataChanged.createdAt += 1
    await expect(decodeState(encodeJson(metadataChanged))).rejects.toMatchObject({
      code: 'checksum-mismatch',
    })
  })

  it('encode também rejeita um record alterado depois de receber seu checksum', async () => {
    const { record } = await encoded()
    ;(record.payload as { core: { ram: Uint8Array } }).core.ram[0] = 1
    await expect(encodeState(record)).rejects.toMatchObject({ code: 'checksum-mismatch' })
  })

  it('outro cartucho, modelo e versão recebem erros distintos', async () => {
    const { bytes } = await encoded()
    await expect(decodeState(bytes, ROM_B)).rejects.toMatchObject({ code: 'wrong-rom' })
    const record = JSON.parse(new TextDecoder().decode(bytes))
    record.model = 'CGB'
    await expect(decodeState(encodeJson(record))).rejects.toMatchObject({ code: 'wrong-model' })
    record.model = 'DMG-CPU-B'
    record.version = 2
    await expect(decodeState(encodeJson(record))).rejects.toMatchObject({
      code: 'incompatible-version',
    })
  })

  it.each(['Uint16Array', 'Buffer', '__proto__'])('recusa tag não autorizada %s', async (tag) => {
    const { bytes } = await encoded()
    const record = JSON.parse(new TextDecoder().decode(bytes))
    record.payload.core.ram.$type = tag
    await expect(decodeState(encodeJson(record))).rejects.toBeInstanceOf(StateFileError)
  })

  it.each([-1, 256, 1.5, '12'])('recusa byte inválido %j', async (byte) => {
    const { bytes } = await encoded()
    const record = JSON.parse(new TextDecoder().decode(bytes))
    record.payload.core.ram.data[0] = byte
    await expect(decodeState(encodeJson(record))).rejects.toMatchObject({ code: 'invalid-data' })
  })

  it('recusa chaves de prototype, tags ambíguas, ciclos e arrays com buracos', async () => {
    const unsafe = JSON.parse('{"__proto__":{"polluted":true}}')
    await expect(createStateRecord(ROM_A, 1, unsafe)).rejects.toMatchObject({
      code: 'invalid-data',
    })
    await expect(
      createStateRecord(ROM_A, 1, { $type: 'Uint8Array', data: [1] }),
    ).rejects.toMatchObject({ code: 'invalid-data' })
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    await expect(createStateRecord(ROM_A, 1, cycle)).rejects.toMatchObject({ code: 'invalid-data' })
    await expect(createStateRecord(ROM_A, 1, Array(2))).rejects.toMatchObject({
      code: 'invalid-data',
    })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, new Date(), new Float32Array(1)])(
    'recusa valor não serializável %s',
    async (value) => {
      await expect(createStateRecord(ROM_A, 1, { value })).rejects.toMatchObject({
        code: 'invalid-data',
      })
    },
  )

  it('recusa excesso de tamanho e profundidade antes de aplicar qualquer payload', async () => {
    await expect(decodeState(new Uint8Array(MAX_STATE_BYTES + 1))).rejects.toMatchObject({
      code: 'too-large',
    })
    await expect(createStateRecord(ROM_A, 1, 'x'.repeat(MAX_STATE_BYTES))).rejects.toMatchObject({
      code: 'too-large',
    })
    await expect(
      createStateRecord(ROM_A, 1, new Uint8Array(MAX_STATE_BYTES)),
    ).rejects.toMatchObject({ code: 'too-large' })
    let nested: unknown = 0
    for (let depth = 0; depth < 70; depth += 1) nested = { next: nested }
    await expect(createStateRecord(ROM_A, 1, nested)).rejects.toMatchObject({
      code: 'invalid-data',
    })
  })

  it('recusa UTF-8 inválido, JSON truncado, campos extras e slot fora de 1 a 3', async () => {
    await expect(decodeState(new Uint8Array([0xff, 0xfe]))).rejects.toMatchObject({
      code: 'invalid-data',
    })
    await expect(decodeState(new TextEncoder().encode('{'))).rejects.toMatchObject({
      code: 'invalid-data',
    })
    const { record } = await encoded()
    await expect(encodeState({ ...record, extra: true } as StateRecord)).rejects.toMatchObject({
      code: 'invalid-data',
    })
    await expect(createStateRecord(ROM_A, 4 as 1, {})).rejects.toMatchObject({
      code: 'invalid-data',
    })
  })
})
