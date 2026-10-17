import { DMG_CLOCK_HZ } from '../core/model'
import type { AudioDiagnostics } from '../platform/audio/audio-output'
import type { PresentationDiagnostics } from './emulator-client'
import type { AudioProducerDiagnostics } from './worker-protocol'

export interface PerformancePoint {
  at: number
  tCycles: number
  frameId: number
  drawnFrames: number
  machineEpoch: number
  playing: boolean
  rewinding: boolean
  audio: AudioDiagnostics | null
  presentation?: PresentationDiagnostics
  audioProducer?: AudioProducerDiagnostics | null
}

export interface PerformanceInterval {
  elapsedSeconds: number
  speedPercent: number | null
  drawnFramesPerSecond: number | null
  underrunFrames: number | null
  droppedFrames: number | null
  interrupted: boolean
}

/** Compara contadores cumulativos usando somente o relógio da página. */
export function measurePerformance(
  before: PerformancePoint,
  after: PerformancePoint,
): PerformanceInterval {
  const elapsedSeconds = (after.at - before.at) / 1000
  const validCounters = [before, after].every((point) =>
    [point.tCycles, point.frameId, point.drawnFrames, point.machineEpoch].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ),
  )
  const audioReset =
    before.audio?.connected &&
    after.audio?.connected &&
    (after.audio.renderedFrames < before.audio.renderedFrames ||
      after.audio.underrunFrames < before.audio.underrunFrames ||
      after.audio.droppedFrames < before.audio.droppedFrames)
  const producerReset =
    Boolean(before.audioProducer) !== Boolean(after.audioProducer) ||
    [before.audioProducer, after.audioProducer].some(
      (producer) =>
        producer && (!Number.isSafeInteger(producer.droppedFrames) || producer.droppedFrames < 0),
    ) ||
    Boolean(
      before.audioProducer &&
      after.audioProducer &&
      after.audioProducer.droppedFrames < before.audioProducer.droppedFrames,
    )
  const interrupted =
    !validCounters ||
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds <= 0 ||
    !before.playing ||
    !after.playing ||
    before.rewinding ||
    after.rewinding ||
    after.tCycles < before.tCycles ||
    after.frameId < before.frameId ||
    after.drawnFrames < before.drawnFrames ||
    after.machineEpoch !== before.machineEpoch ||
    Boolean(audioReset) ||
    producerReset ||
    before.audio?.epoch !== after.audio?.epoch ||
    before.audio?.connected !== after.audio?.connected
  const sameAudio =
    !interrupted &&
    before.audio?.connected &&
    after.audio?.connected &&
    before.audio.epoch === after.audio.epoch &&
    [
      before.audio.underrunFrames,
      after.audio.underrunFrames,
      before.audio.droppedFrames,
      after.audio.droppedFrames,
    ].every((value) => Number.isSafeInteger(value) && value >= 0) &&
    after.audio.underrunFrames >= before.audio.underrunFrames &&
    after.audio.droppedFrames >= before.audio.droppedFrames
  return {
    elapsedSeconds,
    interrupted,
    speedPercent: interrupted
      ? null
      : ((after.tCycles - before.tCycles) / DMG_CLOCK_HZ / elapsedSeconds) * 100,
    drawnFramesPerSecond: interrupted
      ? null
      : (after.drawnFrames - before.drawnFrames) / elapsedSeconds,
    underrunFrames: sameAudio ? after.audio!.underrunFrames - before.audio!.underrunFrames : null,
    droppedFrames: sameAudio
      ? after.audio!.droppedFrames -
        before.audio!.droppedFrames +
        ((after.audioProducer?.droppedFrames ?? 0) - (before.audioProducer?.droppedFrames ?? 0))
      : null,
  }
}
