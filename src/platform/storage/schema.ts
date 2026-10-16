export const SAVE_DATABASE_NAME = 'pocket-lab-saves'
export const SAVE_DATABASE_VERSION = 2
export const BATTERY_STORE_NAME = 'battery'
export const BATTERY_RECORD_VERSION = 1
export const STATE_STORE_NAME = 'states'
export const STATE_ROM_INDEX = 'romId'

/** O envelope da bateria permanece v1, independentemente da versão do banco. */
export interface BatteryRecord {
  readonly version: typeof BATTERY_RECORD_VERSION
  readonly romId: string
  readonly byteLength: number
  readonly bytes: ArrayBuffer
  readonly updatedAt: number
}
