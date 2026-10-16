import { describe, expect, it } from 'vitest'
import { SerialPort } from '../../src/core/serial'

describe('SerialPort DMG desconectada', () => {
  it('desloca um bit a cada 512 T-cycles e completa exatamente em 4096', () => {
    const serial = new SerialPort()
    serial.writeData(0x41)
    serial.writeControl(0x81)
    expect(serial.readControl()).toBe(0xff)
    expect(serial.tick(511)).toBe(false)
    expect(serial.readData()).toBe(0x41)
    expect(serial.tick(1)).toBe(false)
    expect(serial.readData()).toBe(0x83)
    expect(serial.tick(3583)).toBe(false)
    expect(serial.pendingOutputBytes).toBe(0)
    expect(serial.tick(1)).toBe(true)
    expect(serial.readData()).toBe(0xff)
    expect(serial.readControl()).toBe(0x7f)
    expect(serial.drainOutput()).toEqual({ bytes: Uint8Array.of(0x41), text: 'A', droppedBytes: 0 })
    expect(serial.drainOutput().bytes).toHaveLength(0)
  })

  it('não produz saída sem enable ou sem clock externo conectado', () => {
    const serial = new SerialPort()
    serial.writeData(0x42)
    expect(serial.tick(8192)).toBe(false)
    serial.writeControl(0x80)
    expect(serial.tick(8192)).toBe(false)
    expect(serial.readData()).toBe(0x42)
    expect(serial.readControl() & 0x80).toBe(0x80)
    expect(serial.pendingOutputBytes).toBe(0)
  })

  it('cancelar uma transferência não emite bytes parciais', () => {
    const serial = new SerialPort()
    serial.writeData(0x41)
    serial.writeControl(0x81)
    serial.tick(2048)
    serial.writeControl(0x01)
    serial.tick(8192)
    expect(serial.pendingOutputBytes).toBe(0)
    serial.writeData(0x42)
    serial.writeControl(0x81)
    expect(serial.tick(4096)).toBe(true)
    expect(serial.drainOutput().text).toBe('B')
  })

  it('preserva a ordem de bytes e limita memória da observação', () => {
    const serial = new SerialPort()
    for (let index = 0; index < 4097; index += 1) {
      serial.writeData(index)
      serial.writeControl(0x81)
      serial.tick(4096)
    }
    const output = serial.drainOutput()
    expect(output.bytes).toHaveLength(4096)
    expect(output.bytes[0]).toBe(1)
    expect(output.bytes[4095]).toBe(0)
    expect(output.droppedBytes).toBe(1)
    expect(serial.drainOutput().droppedBytes).toBe(0)
  })

  it('ignora o bit de velocidade CGB e ciclos excedentes após completar', () => {
    const serial = new SerialPort()
    serial.writeData(0x50)
    serial.writeControl(0x83)
    expect(serial.tick(4096 * 10)).toBe(true)
    expect(serial.tick(4096)).toBe(false)
    expect(serial.drainOutput().text).toBe('P')
  })
})
