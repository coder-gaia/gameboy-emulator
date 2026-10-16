import { useEffect, useRef, useState } from 'react'
import type { EmulatorClient } from '../../runtime/emulator-client'
import { StateRepository } from '../../platform/storage'
import { createStateRecord, decodeState, encodeState, MAX_STATE_BYTES } from '../../platform/states'
import type { StateSlot } from '../../platform/states'
import styles from './SaveStates.module.css'

interface SlotSummary {
  slot: StateSlot
  createdAt: number
  framebuffer: Uint8Array | null
}

interface OperationResult {
  message: string
  refresh: boolean
}

class CancelledOperation extends Error {}

function StatePreview({ pixels }: { pixels: Uint8Array | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context || !pixels) return
    const image = context.createImageData(160, 144)
    const shades = [
      [193, 206, 145],
      [149, 166, 99],
      [96, 112, 64],
      [60, 73, 51],
    ]
    for (let index = 0; index < pixels.length; index += 1) {
      const shade = shades[pixels[index]!]!
      image.data.set([...shade, 255], index * 4)
    }
    context.putImageData(image, 0, 0)
  }, [pixels])
  return pixels ? (
    <canvas ref={canvas} width={160} height={144} className={styles.preview} aria-hidden="true" />
  ) : (
    <span className={`${styles.preview} ${styles.emptyPreview}`} aria-hidden="true">
      <span />
    </span>
  )
}

export function SaveStates({
  device,
  title,
  disabled,
  onPause,
  onLoaded,
  onBusyChange,
}: {
  device: EmulatorClient
  title: string
  disabled: boolean
  onPause: () => Promise<void>
  onLoaded: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const [slots, setSlots] = useState<SlotSummary[]>([])
  const [selected, setSelected] = useState<StateSlot>(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const repository = useRef<StateRepository | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const operation = useRef(0)
  const busyRef = useRef(false)
  const romId = device.romId

  useEffect(() => {
    active.current = true
    const storage = new StateRepository()
    repository.current = storage
    void storage
      .listStates(romId)
      .then((records) => {
        if (repository.current === storage) setSlots(records)
      })
      .catch((cause: unknown) => {
        if (repository.current === storage)
          setNotice(
            cause instanceof Error ? cause.message : 'Não foi possível ler os slots locais.',
          )
      })
    return () => {
      active.current = false
      operation.current += 1
      if (repository.current === storage) repository.current = null
      storage.close()
      onBusyChange(false)
    }
  }, [romId, onBusyChange])

  async function run(
    action: (
      storage: StateRepository,
      ensureCurrent: () => void,
    ) => Promise<string | OperationResult>,
  ) {
    const storage = repository.current
    if (busyRef.current || disabled || !storage) return
    const token = ++operation.current
    const ensureCurrent = () => {
      if (!active.current || token !== operation.current || repository.current !== storage)
        throw new CancelledOperation()
    }
    busyRef.current = true
    setBusy(true)
    onBusyChange(true)
    setNotice('')
    try {
      const result = await action(storage, ensureCurrent)
      ensureCurrent()
      let message = typeof result === 'string' ? result : result.message
      if (active.current && token === operation.current) {
        if (typeof result === 'string' || result.refresh) {
          try {
            const records = await storage.listStates(romId)
            ensureCurrent()
            setSlots(records)
          } catch (cause) {
            if (cause instanceof CancelledOperation) throw cause
            message += ` Não foi possível atualizar a lista dos slots. ${cause instanceof Error ? cause.message : ''}`
          }
        }
        setNotice(message)
      }
    } catch (cause) {
      if (!(cause instanceof CancelledOperation) && active.current && token === operation.current)
        setNotice(
          cause instanceof Error ? cause.message : 'Não foi possível concluir esta operação.',
        )
    } finally {
      if (active.current && token === operation.current) {
        busyRef.current = false
        setBusy(false)
        onBusyChange(false)
      }
    }
  }

  function save() {
    void run(async (storage, ensureCurrent) => {
      ensureCurrent()
      await onPause()
      ensureCurrent()
      const checkpoint = await device.captureState()
      ensureCurrent()
      const record = await createStateRecord(romId, selected, checkpoint)
      ensureCurrent()
      await storage.saveState(record)
      return `Estado salvo no slot ${selected}. Use Iniciar para continuar.`
    })
  }

  function load() {
    void run(async (storage, ensureCurrent) => {
      const record = await storage.loadState(romId, selected)
      ensureCurrent()
      if (!record) throw new Error('Este slot ainda está vazio.')
      await onPause()
      ensureCurrent()
      await device.loadState(record.payload)
      ensureCurrent()
      onLoaded()
      return `Slot ${selected} carregado. Use Iniciar para continuar desse ponto.`
    })
  }

  function exportFile() {
    void run(async (_storage, ensureCurrent) => {
      ensureCurrent()
      await onPause()
      ensureCurrent()
      const checkpoint = await device.captureState()
      ensureCurrent()
      const record = await createStateRecord(romId, selected, checkpoint)
      ensureCurrent()
      const bytes = await encodeState(record)
      ensureCurrent()
      const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `pocketlab-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${selected}.pocketstate`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return {
        message: 'O ponto atual foi exportado. Guarde o arquivo para usar com este cartucho.',
        refresh: false,
      }
    })
  }

  function importFile(file: File | undefined) {
    if (!file) return
    void run(async (storage, ensureCurrent) => {
      if (!/\.pocketstate$/i.test(file.name))
        throw new Error('Escolha um arquivo .pocketstate do Pocket Lab.')
      if (file.size > MAX_STATE_BYTES)
        throw new Error('O arquivo de estado ultrapassa o limite de 1 MiB.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      ensureCurrent()
      const record = await decodeState(bytes, romId)
      ensureCurrent()
      await onPause()
      ensureCurrent()
      await device.loadState(record.payload)
      ensureCurrent()
      onLoaded()
      try {
        const imported = await createStateRecord(romId, selected, record.payload, record.createdAt)
        ensureCurrent()
        await storage.saveState(imported)
      } catch (cause) {
        if (cause instanceof CancelledOperation) throw cause
        return {
          message: `A partida foi retomada em pausa, mas o slot não pôde ser gravado. ${cause instanceof Error ? cause.message : 'Guarde o arquivo exportado.'}`,
          refresh: false,
        }
      }
      return `Arquivo importado no slot ${selected}. Use Iniciar para continuar.`
    })
  }

  const populated = slots.some((slot) => slot.slot === selected)
  return (
    <section className={styles.panel} aria-labelledby="states-title">
      <div className={styles.heading}>
        <span className={styles.marker} aria-hidden="true">
          03
        </span>
        <div>
          <h2 id="states-title">Um ponto para voltar.</h2>
          <p>Guarde a partida exatamente como ela está.</p>
        </div>
      </div>
      <fieldset className={styles.slots} disabled={busy || disabled}>
        <legend className="sr-only">Slots do cartucho</legend>
        {([1, 2, 3] as const).map((slot) => {
          const saved = slots.find((record) => record.slot === slot)
          return (
            <label
              key={slot}
              className={`${styles.slot} ${selected === slot ? styles.selected : ''}`}
            >
              <input
                type="radio"
                name="state-slot"
                aria-label={`Slot ${slot}`}
                checked={selected === slot}
                onChange={() => setSelected(slot)}
              />
              <span>Slot {slot}</span>
              <StatePreview pixels={saved?.framebuffer ?? null} />
              <small>
                {saved
                  ? new Date(saved.createdAt).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : 'Vazio'}
              </small>
            </label>
          )
        })}
      </fieldset>
      <div className={styles.actions}>
        <button type="button" onClick={save} disabled={busy || disabled}>
          Salvar estado
        </button>
        <button type="button" onClick={load} disabled={busy || disabled || !populated}>
          Carregar estado
        </button>
        <button type="button" onClick={exportFile} disabled={busy || disabled}>
          Exportar estado
        </button>
        <button type="button" onClick={() => input.current?.click()} disabled={busy || disabled}>
          Importar estado
        </button>
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".pocketstate"
        aria-label="Arquivo de estado"
        tabIndex={-1}
        onChange={(event) => {
          importFile(event.currentTarget.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <p className={styles.note}>
        Salvar substitui o ponto do slot selecionado e pausa a partida. Exportar guarda o ponto
        atual em um arquivo, mesmo sem um slot salvo.
      </p>
      <p className={styles.note}>
        Os slots ficam neste navegador, separados por cartucho. Bateria é o save feito pelo próprio
        jogo; um estado guarda a máquina inteira.
      </p>
      {busy && <p className={styles.notice}>Preparando seu ponto de retorno...</p>}
      {notice && (
        <p className={styles.notice} role="status" aria-label="Estado dos slots">
          {notice}
        </p>
      )}
    </section>
  )
}
