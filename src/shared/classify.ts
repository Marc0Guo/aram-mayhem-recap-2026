import type { ModeClass } from './types'
import { CLASSIFICATION_VERSION, QUEUE_ALLOWLIST, type QueueAllowlist } from './allowlist'

export interface Classification {
  modeClass: ModeClass
  classificationVersion: string
  countsAsMayhem: boolean
}

export function classifyQueue(queueId: number | null, allowlist: QueueAllowlist = QUEUE_ALLOWLIST): Classification {
  const version = allowlist.version || CLASSIFICATION_VERSION
  if (queueId == null || !Number.isInteger(queueId)) {
    return { modeClass: 'unknown', classificationVersion: version, countsAsMayhem: false }
  }
  if (allowlist.confirmedMayhem.includes(queueId)) {
    return { modeClass: 'mayhem', classificationVersion: version, countsAsMayhem: true }
  }
  if (allowlist.ordinaryAram.includes(queueId)) {
    return { modeClass: 'aram', classificationVersion: version, countsAsMayhem: false }
  }
  if (allowlist.candidateMayhem.includes(queueId)) {
    return { modeClass: 'unconfirmed', classificationVersion: version, countsAsMayhem: false }
  }
  return { modeClass: 'unknown', classificationVersion: version, countsAsMayhem: false }
}
