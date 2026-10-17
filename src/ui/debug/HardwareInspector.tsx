import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { HardwareDebugSnapshot } from '../../core/debug'
import type { EmulatorClient } from '../../runtime/emulator-client'
import { OamPreview, TileAtlas } from './HardwareGraphics'
import styles from './HardwareInspector.module.css'

interface HardwareInspectorProps {
  device: EmulatorClient
  disabled?: boolean
}

interface InspectionResult {
  device: EmulatorClient
  memoryStart: number
  snapshot: HardwareDebugSnapshot | null
  error: string
}

const PAGE_SIZE = 256
const LAST_PAGE = 0xff00
const OFFSETS = Array.from({ length: 16 }, (_, index) => index)
const PPU_MODES = ['Pausa horizontal', 'Pausa vertical', 'Leitura OAM', 'Transferência de pixels']

function hex(value: number, width = 2): string {
  return value.toString(16).padStart(width, '0').toUpperCase()
}

function yesNo(value: boolean): string {
  return value ? 'Sim' : 'Não'
}

function flagsDescription(flags: number): string {
  const parts = [
    (flags & 0x80) !== 0 ? 'atrás do fundo' : 'à frente do fundo',
    (flags & 0x40) !== 0 ? 'flip Y' : null,
    (flags & 0x20) !== 0 ? 'flip X' : null,
    (flags & 0x10) !== 0 ? 'OBP1' : 'OBP0',
  ]
  return parts.filter(Boolean).join(', ')
}

function RegisterList({
  title,
  values,
}: {
  title: string
  values: readonly (readonly [string, string | number])[]
}) {
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      <dl className={styles.registers}>
        {values.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Disassembly({ snapshot }: { snapshot: HardwareDebugSnapshot }) {
  return (
    <section className={styles.section}>
      <h3>Próximas instruções</h3>
      <div className={styles.scroll} role="region" aria-label="Desassemblador" tabIndex={0}>
        <table className={styles.disassembly}>
          <caption>12 instruções a partir do PC, conforme o mapeamento atual.</caption>
          <thead>
            <tr>
              <th scope="col">PC</th>
              <th scope="col">Endereço</th>
              <th scope="col">Bytes</th>
              <th scope="col">Instrução</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.disassembly.map((instruction) => {
              const current = instruction.address === snapshot.cpu.pc
              return (
                <tr
                  key={instruction.address}
                  aria-current={current ? 'location' : undefined}
                  className={current ? styles.currentInstruction : undefined}
                >
                  <td>{current && <span className={styles.pcMarker}>PC</span>}</td>
                  <th scope="row">${hex(instruction.address, 4)}</th>
                  <td>{Array.from(instruction.bytes, (byte) => hex(byte)).join(' ')}</td>
                  <td className={instruction.valid ? undefined : styles.invalidInstruction}>
                    {instruction.mnemonic}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function OamTable({ oam }: { oam: Uint8Array }) {
  return (
    <div className={styles.scroll} role="region" aria-label="Tabela OAM" tabIndex={0}>
      <table className={styles.oam}>
        <caption>40 sprites. Coordenadas relativas à tela: X menos 8 e Y menos 16.</caption>
        <thead>
          <tr>
            <th scope="col">Objeto</th>
            <th scope="col">X</th>
            <th scope="col">Y</th>
            <th scope="col">Tile</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 40 }, (_, index) => {
            const flags = oam[index * 4 + 3]!
            return (
              <tr key={index}>
                <th scope="row">{String(index).padStart(2, '0')}</th>
                <td>{oam[index * 4 + 1]! - 8}</td>
                <td>{oam[index * 4]! - 16}</td>
                <td>${hex(oam[index * 4 + 2]!)}</td>
                <td>
                  <span aria-label={`Flags $${hex(flags)}: ${flagsDescription(flags)}`}>
                    ${hex(flags)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MemoryTable({ memory }: { memory: HardwareDebugSnapshot['memory'] }) {
  return (
    <div className={styles.scroll} role="region" aria-label="Conteúdo da memória" tabIndex={0}>
      <table className={styles.memory}>
        <caption>
          Página ${hex(memory.start, 4)} a ${hex(memory.start + PAGE_SIZE - 1, 4)}, somente leitura.
        </caption>
        <thead>
          <tr>
            <th scope="col">Endereço</th>
            {OFFSETS.map((offset) => (
              <th scope="col" key={offset}>
                {hex(offset, 1)}
              </th>
            ))}
            <th scope="col">Texto</th>
          </tr>
        </thead>
        <tbody>
          {OFFSETS.map((row) => (
            <tr key={row}>
              <th scope="row">${hex(memory.start + row * 16, 4)}</th>
              {OFFSETS.map((column) => (
                <td key={column}>{hex(memory.bytes[row * 16 + column]!)}</td>
              ))}
              <td>
                {Array.from(memory.bytes.subarray(row * 16, row * 16 + 16), (byte) =>
                  byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '·',
                ).join('')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function HardwareInspector({ device, disabled = false }: HardwareInspectorProps) {
  const [open, setOpen] = useState(false)
  const [memoryStart, setMemoryStart] = useState(0xc000)
  const [address, setAddress] = useState('C000')
  const [addressError, setAddressError] = useState('')
  const [result, setResult] = useState<InspectionResult | null>(null)
  const inFlight = useRef<Promise<HardwareDebugSnapshot> | null>(null)
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()

  useEffect(() => {
    if (!open || disabled) return
    let cancelled = false
    let failed = false
    let visibilityRevision = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    const schedule = (): void => {
      clearTimer()
      if (!cancelled && !failed && !document.hidden) timer = setTimeout(() => void poll(), 500)
    }
    async function poll(): Promise<void> {
      if (cancelled || failed || document.hidden) return
      if (inFlight.current !== null) {
        schedule()
        return
      }
      const requestedAtVisibility = visibilityRevision
      const request = device.inspectHardware(memoryStart)
      inFlight.current = request
      try {
        const snapshot = await request
        if (!cancelled && !document.hidden && requestedAtVisibility === visibilityRevision)
          setResult({ device, memoryStart, snapshot, error: '' })
      } catch (cause) {
        if (!cancelled && !document.hidden && requestedAtVisibility === visibilityRevision) {
          failed = true
          setResult({
            device,
            memoryStart,
            snapshot: null,
            error: cause instanceof Error ? cause.message : 'Não foi possível consultar a máquina.',
          })
        }
      } finally {
        if (inFlight.current === request) inFlight.current = null
        schedule()
      }
    }
    const onVisibility = (): void => {
      visibilityRevision += 1
      clearTimer()
      if (!document.hidden) void poll()
    }
    const unsubscribe = device.subscribeError((cause) => {
      failed = true
      clearTimer()
      if (!cancelled && !document.hidden)
        setResult({ device, memoryStart, snapshot: null, error: cause.message })
    })
    document.addEventListener('visibilitychange', onVisibility)
    void poll()
    return () => {
      cancelled = true
      clearTimer()
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [device, disabled, memoryStart, open])

  function selectPage(next: number): void {
    setMemoryStart(next)
    setAddress(hex(next, 4))
    setAddressError('')
  }

  function submitAddress(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const match = /^(?:0x|\$)?([0-9a-f]{1,4})$/i.exec(address.trim())
    const next = match ? Number.parseInt(match[1]!, 16) : Number.NaN
    if (!Number.isInteger(next) || next < 0 || next > LAST_PAGE || next % PAGE_SIZE !== 0) {
      setAddressError('Use um endereço hexadecimal de 0000 a FF00, terminado em 00. Exemplo: C000.')
      return
    }
    selectPage(next)
  }

  const current = result?.device === device && result.memoryStart === memoryStart ? result : null
  const snapshot = current?.snapshot
  const rtc = snapshot?.cartridge.rtc

  return (
    <details className={styles.panel} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Painel técnico</summary>
      {open && (
        <div className={styles.content}>
          <p className={styles.explanation}>
            Memória, vídeo e registradores da máquina em execução. A leitura é atualizada duas vezes
            por segundo com o painel aberto. Pause o jogo para examinar um instante estável.
          </p>
          {disabled && (
            <p className={styles.explanation}>A inspeção aguarda a liberação do jogo.</p>
          )}
          {current?.error && (
            <p className={styles.error} role="alert">
              {current.error} Feche e abra o painel para tentar novamente.
            </p>
          )}
          {!snapshot && !current?.error && <p className={styles.explanation}>Lendo a máquina...</p>}
          <section className={styles.section}>
            <h3>Memória</h3>
            <form onSubmit={submitAddress}>
              <fieldset disabled={disabled} className={styles.memoryControls}>
                <legend className="sr-only">Escolher página de memória</legend>
                <label htmlFor={inputId}>Endereço hexadecimal</label>
                <div className={styles.addressRow}>
                  <input
                    id={inputId}
                    value={address}
                    onChange={(event) => setAddress(event.currentTarget.value)}
                    aria-describedby={addressError ? `${hintId} ${errorId}` : hintId}
                    aria-invalid={Boolean(addressError)}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={6}
                  />
                  <button type="submit">Consultar</button>
                </div>
                <p id={hintId} className={styles.hint}>
                  Páginas de 256 bytes, de $0000 a $FF00. Nenhum valor pode ser alterado aqui.
                </p>
                <div className={styles.pageButtons}>
                  <button
                    type="button"
                    onClick={() => selectPage(memoryStart - PAGE_SIZE)}
                    disabled={memoryStart === 0}
                  >
                    Página anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => selectPage(memoryStart + PAGE_SIZE)}
                    disabled={memoryStart === LAST_PAGE}
                  >
                    Próxima página
                  </button>
                </div>
              </fieldset>
            </form>
            {addressError && (
              <p id={errorId} className={styles.error} role="alert">
                {addressError}
              </p>
            )}
            {snapshot && <MemoryTable memory={snapshot.memory} />}
          </section>
          {snapshot && (
            <>
              <p className={styles.sample}>
                <span>
                  T-cycles:{' '}
                  <output aria-label="T-cycles da inspeção" aria-live="off">
                    {snapshot.tCycles}
                  </output>
                </span>
                <span>Quadro: {snapshot.frameId}</span>
              </p>
              <Disassembly snapshot={snapshot} />
              <section className={styles.section}>
                <h3>Tiles da VRAM</h3>
                <TileAtlas vram={snapshot.vram} />
              </section>
              <section className={styles.section}>
                <h3>Sprites da OAM</h3>
                <OamPreview vram={snapshot.vram} oam={snapshot.oam} lcdc={snapshot.ppu.lcdc} />
                <OamTable oam={snapshot.oam} />
              </section>
              <RegisterList
                title="Vídeo e PPU"
                values={[
                  ['LCDC', `$${hex(snapshot.ppu.lcdc)}`],
                  ['STAT', `$${hex(snapshot.ppu.stat)}`],
                  ['Modo', `${snapshot.ppu.mode}: ${PPU_MODES[snapshot.ppu.mode]}`],
                  ['LY / LYC', `${snapshot.ppu.ly} / ${snapshot.ppu.lyc}`],
                  ['SCX / SCY', `${snapshot.ppu.scx} / ${snapshot.ppu.scy}`],
                  ['WX / WY', `${snapshot.ppu.wx} / ${snapshot.ppu.wy}`],
                  ['T-cycles na linha', snapshot.ppu.lineTCycles],
                ]}
              />
              <RegisterList
                title="Timer"
                values={[
                  ['DIV (16 bits)', `$${hex(snapshot.timer.divider, 4)}`],
                  ['TIMA', `$${hex(snapshot.timer.counter)}`],
                  ['TMA', `$${hex(snapshot.timer.modulo)}`],
                  ['TAC', `$${hex(snapshot.timer.control)}`],
                  ['Recarga pendente', `${snapshot.timer.reloadDelay} T`],
                  ['Janela de recarga', `${snapshot.timer.reloadWindow} T`],
                ]}
              />
              <RegisterList
                title="DMA e interrupções"
                values={[
                  ['DMA ativo', yesNo(snapshot.dma.transferring)],
                  ['Origem', `$${hex(snapshot.dma.source, 4)}`],
                  ['Bytes copiados', `${snapshot.dma.index} / 160`],
                  ['Início pendente', `${snapshot.dma.startupTCycles} T`],
                  ['IE', `$${hex(snapshot.interruptEnable)}`],
                  ['IF', `$${hex(snapshot.interruptFlags)}`],
                  ['IME', yesNo(snapshot.cpu.ime)],
                ]}
              />
              <RegisterList
                title="Cartucho e RTC"
                values={[
                  [
                    'Controlador',
                    snapshot.cartridge.mapper === 'ROM_ONLY'
                      ? 'ROM Only'
                      : snapshot.cartridge.mapper,
                  ],
                  ['Título do header', snapshot.cartridge.title || 'Sem título'],
                  ['ROM', `${snapshot.cartridge.romSize / 1024} KiB`],
                  ['RAM', `${snapshot.cartridge.ramSize / 1024} KiB`],
                  ['RTC presente', yesNo(snapshot.cartridge.hasRtc)],
                  ...(rtc
                    ? ([
                        [
                          'Relógio',
                          `${String(rtc.hours).padStart(2, '0')}:${String(rtc.minutes).padStart(2, '0')}:${String(rtc.seconds).padStart(2, '0')}`,
                        ],
                        ['Dias', rtc.days],
                        ['RTC parado', yesNo(rtc.halted)],
                        ['Carry de dias', yesNo(rtc.carry)],
                        ['Fração de segundo', `${rtc.subsecondTCycles} T`],
                      ] as const)
                    : []),
                ]}
              />
            </>
          )}
        </div>
      )}
    </details>
  )
}
