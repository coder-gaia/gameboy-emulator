export const SAVE_DATABASE_NAME = 'pocket-lab-saves'
export const SAVE_DATABASE_VERSION = 2
export const BATTERY_STORE_NAME = 'battery'
export const BATTERY_RECORD_VERSION = 1
export const RTC_BATTERY_RECORD_VERSION = 2
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
import type { CartridgeRtcState } from '../../core/cartridge'

export interface RtcBatteryRecord extends Omit<BatteryRecord, 'version'> {
  readonly version: typeof RTC_BATTERY_RECORD_VERSION
  readonly rtc: CartridgeRtcState
}

export interface BatteryState {
  readonly bytes: Uint8Array
  readonly rtc: CartridgeRtcState | null
  readonly updatedAt: number
}
