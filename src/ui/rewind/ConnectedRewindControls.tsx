import { useSyncExternalStore } from 'react'
import type { EmulatorClient } from '../../runtime/emulator-client'
import { RewindControls } from './RewindControls'
import type { RewindControlsProps } from './RewindControls'

export function ConnectedRewindControls({
  device,
  ...props
}: Omit<RewindControlsProps, 'enabled' | 'availableSeconds'> & { device: EmulatorClient }) {
  const state = useSyncExternalStore(device.subscribeRewind, () => device.rewind)
  return (
    <RewindControls {...props} enabled={state.enabled} availableSeconds={state.availableSeconds} />
  )
}
