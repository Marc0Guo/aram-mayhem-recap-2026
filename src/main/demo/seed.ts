import dataset from '../../../fixtures/demo/dataset.json'
import { DEMO_ADAPTER_VERSION } from '@shared/allowlist'
import type { NormalizedMatch, ResultState } from '@shared/types'
import type { WrappedDatabase } from '../db/repository'

interface DemoMatch {
  gameId: string
  startOffsetHours: number
  result: ResultState
  championId: number
  augments: string[] | null
  items: number[]
}

export function seedDemo(db: WrappedDatabase, now: number, alias = dataset.account.defaultAlias): { accountId: string } {
  const account = db.upsertAccount({
    platformId: dataset.account.platformId,
    puuid: dataset.account.puuid,
    alias,
    now
  })
  for (const row of dataset.matches as DemoMatch[]) {
    const match = toMatch(row, now)
    const status = db.commitMatch(account.accountId, match, now)
    if (status === 'skipped') db.rebaseStart(match.platformId, match.gameId, match.startUtc)
  }
  db.setSetting('demoSeedVersion', dataset.version)
  db.setSetting('activeAccountId', account.accountId)
  db.writeSyncState(account.accountId, {
    lastSuccessfulScan: now,
    latestSeenStart: now - 20 * 60 * 60 * 1000,
    adapterVersion: DEMO_ADAPTER_VERSION,
    continuation: {
      needsBackfill: false,
      partial: false,
      reason: 'demo',
      gaps: [],
      pendingIds: [],
      lastExhaustiveAt: now,
      earliestAccessibleUtc: now - 240 * 60 * 60 * 1000
    }
  })
  return account
}

function toMatch(row: DemoMatch, now: number): NormalizedMatch {
  const recorded = row.augments != null
  return {
    platformId: dataset.account.platformId,
    gameId: row.gameId,
    queueId: null,
    modeClass: 'mayhem',
    classificationVersion: 'demo-2026-10-20',
    startUtc: now - row.startOffsetHours * 60 * 60 * 1000,
    durationSeconds: 1200,
    resultState: row.result,
    patch: 'demo',
    ingestStatus: 'complete',
    adapterVersion: DEMO_ADAPTER_VERSION,
    selfParticipantId: '1',
    participants: [
      {
        participantId: '1',
        teamId: '100',
        championId: row.championId,
        win: row.result === 'win' ? true : row.result === 'loss' ? false : null,
        kills: 10,
        deaths: 5,
        assists: 5,
        championDamage: 12000,
        gold: 14000,
        augmentStatus: recorded ? 'recorded' : 'unavailable',
        augments: (row.augments ?? []).map((augmentId, index) => ({
          selectionSlot: index,
          augmentId,
          sourceField: 'demoAugments',
          orderKnown: true
        })),
        itemsStatus: 'readable',
        items: row.items.map((itemId, slot) => ({ slot, itemId }))
      }
    ],
    raw: { synthetic: true, gameId: row.gameId, result: row.result, championId: row.championId, augments: row.augments, items: row.items },
    sourceSchema: 'demo-2026-10-20'
  }
}
