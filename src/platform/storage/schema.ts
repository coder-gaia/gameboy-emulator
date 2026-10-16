export const SAVE_DATABASE_NAME = 'pocket-lab-saves'
export const SAVE_DATABASE_VERSION = 1
export const BATTERY_STORE_NAME = 'battery'
export const BATTERY_RECORD_VERSION = 1

/** O próximo upgrade pode acrescentar slots sem excluir este store de bateria. */
export interface BatteryRecord {
  readonly version: typeof BATTERY_RECORD_VERSION
  readonly romId: string
  readonly byteLength: number
  readonly bytes: ArrayBuffer
  readonly updatedAt: number
}
