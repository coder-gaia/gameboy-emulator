import type { LoadedCartridge } from '../../platform/files/load-cartridge'
import styles from './CartridgeDetails.module.css'

const mapperNames = {
  ROM_ONLY: 'ROM Only',
  MBC1: 'MBC1',
  MBC2: 'MBC2',
  MBC3: 'MBC3',
  MBC5: 'MBC5',
  UNKNOWN: 'Desconhecido',
}

export function CartridgeDetails({ cartridge }: { cartridge: LoadedCartridge }) {
  const { metadata } = cartridge
  return (
    <section className={styles.details} aria-labelledby="cartridge-title">
      <p className={styles.label}>CARTUCHO CONECTADO</p>
      <h3 id="cartridge-title">{metadata.title}</h3>
      <p className={styles.fileName}>{cartridge.fileName}</p>
      <dl className={styles.metadata}>
        <div>
          <dt>Controlador</dt>
          <dd>{mapperNames[metadata.mapper]}</dd>
        </div>
        <div>
          <dt>ROM</dt>
          <dd>{metadata.romSize / 1024} KiB</dd>
        </div>
        <div>
          <dt>RAM</dt>
          <dd>{metadata.ramSize / 1024} KiB</dd>
        </div>
        <div>
          <dt>Bateria</dt>
          <dd>{metadata.hasBattery ? 'Sim' : 'Não'}</dd>
        </div>
      </dl>
      {metadata.warnings.length > 0 && (
        <ul className={styles.warnings} aria-label="Observações do cartucho">
          {metadata.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <p className={styles.note}>
        {metadata.isSupported
          ? 'Cartucho lido localmente. Use Iniciar para executar.'
          : 'Dados lidos do cartucho. O suporte de execução está em preparação.'}
      </p>
    </section>
  )
}
