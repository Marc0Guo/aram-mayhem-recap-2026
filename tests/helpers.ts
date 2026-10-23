import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openWrappedDatabase } from '../src/main/db/open'
import type { WrappedDatabase } from '../src/main/db/repository'
import type { NormalizedMatch } from '../src/shared/types'

export async function tempDatabase(): Promise<{ root: string; db: WrappedDatabase; close: () => void }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-wrapped-'))
  const file = path.join(root, 'data', 'wrapped.sqlite')
  const opened = await openWrappedDatabase(file)
  if (!opened.database) throw new Error('database-unavailable')
  const db = opened.database
  return {
    root,
    db,
    close: () => {
      db.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

export function mayhemMatch(gameId: string, startUtc: number, patch: Record<string, unknown> = {}): NormalizedMatch {
  const kills = typeof patch.kills === 'number' ? patch.kills : 10
  const deaths = typeof patch.deaths === 'number' ? patch.deaths : 5
  const assists = typeof patch.assists === 'number' ? patch.assists : 5
  const damage = typeof patch.damage === 'number' ? patch.damage : 12000
  const duration = patch.duration === undefined ? 1200 : (patch.duration as number | null)
  const result = patch.result === 'loss' || patch.result === 'remake' || patch.result === 'unknown' ? patch.result : 'win'
  const championId = typeof patch.championId === 'number' ? patch.championId : 157
  const augments = Array.isArray(patch.augments) ? patch.augments as string[] : ['aug-prism']
  const items = Array.isArray(patch.items) ? patch.items as number[] : [3031, 1001, 0]
  const participantId = typeof patch.participantId === 'string' ? patch.participantId : '1'
  return {
    platformId: 'NA1',
    gameId,
    queueId: 9000,
    modeClass: 'mayhem',
    classificationVersion: 'test',
    startUtc,
    durationSeconds: duration,
    resultState: result,
    patch: 'test',
    ingestStatus: 'complete',
    adapterVersion: 'test',
    selfParticipantId: participantId,
    participants: [
      {
        participantId,
        teamId: '100',
        championId,
        win: result === 'win' ? true : result === 'loss' ? false : null,
        kills,
        deaths,
        assists,
        championDamage: damage,
        gold: 1000,
        augmentStatus: patch.augmentStatus === 'unavailable' || patch.augmentStatus === 'explicitNone' ? patch.augmentStatus : 'recorded',
        augments: augments.map((augmentId, index) => ({ selectionSlot: index, augmentId, sourceField: 'test', orderKnown: false })),
        itemsStatus: 'readable',
        items: items.map((itemId, slot) => ({ slot, itemId }))
      }
    ],
    raw: { gameId, marker: patch.marker ?? 'base', kills, deaths, assists },
    sourceSchema: 'test'
  }
}
