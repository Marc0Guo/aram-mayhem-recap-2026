/**
 * Queue 2400 was confirmed on 2026-10-21 from the local client.
 * The observed game mode was KIWI, not ARAM. Self participant linkage and
 * nonzero stats.playerAugment slots were present. See docs/lcu-capabilities.md
 * and fixtures/lcu/mayhem.sanitized.json. Map id and gameMode ARAM still do not
 * classify a queue.
 */
export interface QueueAllowlist {
  version: string
  confirmedMayhem: number[]
  candidateMayhem: number[]
  ordinaryAram: number[]
}

export const QUEUE_ALLOWLIST: QueueAllowlist = {
  version: '2026-10-21.1',
  confirmedMayhem: [2400],
  candidateMayhem: [],
  ordinaryAram: []
}

export const REAL_CLIENT_IMPORT_VERIFIED = true

export const CLASSIFICATION_VERSION = '2026-10-21.1'
export const CANDIDATE_ADAPTER_VERSION = 'lcu-2026-10-23-cache-safe'
export const DEMO_ADAPTER_VERSION = 'demo-2026-10-20'
