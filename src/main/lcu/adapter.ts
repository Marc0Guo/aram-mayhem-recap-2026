import { CANDIDATE_ADAPTER_VERSION, QUEUE_ALLOWLIST, type QueueAllowlist } from '@shared/allowlist'
import { classifyQueue } from '@shared/classify'
import { asIdString } from '@shared/ids'
import type { AugmentStatus, ListedMatch, NormalizedAugment, NormalizedItem, NormalizedMatch, NormalizedParticipant, ResultState } from '@shared/types'
import { AdapterError } from './errors'
import { sanitizeRaw } from './sanitize'

function findGames(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.games)) return record.games
  if (record.games && typeof record.games === 'object') {
    const nested = (record.games as Record<string, unknown>).games
    if (Array.isArray(nested)) return nested
  }
  return null
}

export function adaptCandidateList(payload: unknown): ListedMatch[] {
  const games = findGames(payload)
  if (!games) throw new AdapterError('unrecognized-list-shape')
  const listed: ListedMatch[] = []
  for (const entry of games) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const gameId = asIdString(record.gameId)
    if (!gameId) continue
    const platformId = typeof record.platformId === 'string' && record.platformId ? record.platformId : 'unknown'
    const queueId = typeof record.queueId === 'number' && Number.isSafeInteger(record.queueId) ? record.queueId : null
    const created = record.gameCreation
    const startUtc = typeof created === 'number' && Number.isSafeInteger(created) && created > 1e11 ? created : null
    listed.push({ platformId, gameId, queueId, startUtc })
  }
  return listed
}

export function adaptCandidateDetail(payload: unknown, selfPuuid: string, allowlist: QueueAllowlist = QUEUE_ALLOWLIST): NormalizedMatch {
  if (!payload || typeof payload !== 'object') throw new AdapterError('unrecognized-detail-shape')
  const record = payload as Record<string, unknown>
  const gameId = asIdString(record.gameId)
  if (!gameId) throw new AdapterError('missing-game-id')
  const platformId = typeof record.platformId === 'string' && record.platformId ? record.platformId : 'unknown'
  const queueId = typeof record.queueId === 'number' && Number.isSafeInteger(record.queueId) ? record.queueId : null
  const classification = classifyQueue(queueId, allowlist)
  const created = record.gameCreation
  const startUtc = typeof created === 'number' && Number.isSafeInteger(created) && created > 1e11 ? created : null
  if (startUtc == null) throw new AdapterError('invalid-timestamp')
  const linked = findSelf(record, selfPuuid)
  const { raw } = sanitizeRaw(payload, selfPuuid)
  const selfParticipantId = linked?.participantId ?? null
  const duration = integerOrNull(record.gameDuration)
  const patch = typeof record.gameVersion === 'string' && /^\d+(?:\.\d+){1,3}$/.test(record.gameVersion) ? record.gameVersion : null
  return {
    platformId,
    gameId,
    queueId,
    modeClass: classification.modeClass,
    classificationVersion: classification.classificationVersion,
    startUtc,
    durationSeconds: duration != null && duration >= 0 && duration <= 86400 ? duration : null,
    resultState: linked ? resultOf(linked.stats) : 'unknown',
    patch,
    ingestStatus: selfParticipantId ? 'complete' : 'quarantined',
    adapterVersion: CANDIDATE_ADAPTER_VERSION,
    selfParticipantId,
    participants: linked ? [readParticipant(linked.participantId, linked.participant, linked.stats)] : [],
    raw,
    sourceSchema: CANDIDATE_ADAPTER_VERSION,
    quarantineReason: selfParticipantId ? undefined : 'missing-self'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function findSelf(record: Record<string, unknown>, selfPuuid: string): { participantId: string; participant: Record<string, unknown>; stats: Record<string, unknown> } | null {
  const participants = Array.isArray(record.participants) ? record.participants : []
  const identities = Array.isArray(record.participantIdentities) ? record.participantIdentities : []
  for (const identity of identities) {
    const row = asRecord(identity)
    const player = row ? asRecord(row.player) : null
    const participantId = row ? asIdString(row.participantId) : null
    if (!row || !player || player.puuid !== selfPuuid || !participantId) continue
    const participant = participants.map(asRecord).find((item) => item && asIdString(item.participantId) === participantId)
    if (!participant) continue
    return { participantId, participant, stats: asRecord(participant.stats) ?? participant }
  }
  for (const entry of participants) {
    const participant = asRecord(entry)
    const participantId = participant ? asIdString(participant.participantId) : null
    if (!participant || participant.puuid !== selfPuuid || !participantId) continue
    return { participantId, participant, stats: asRecord(participant.stats) ?? participant }
  }
  return null
}

function resultOf(stats: Record<string, unknown>): ResultState {
  if (typeof stats.win === 'boolean') return stats.win ? 'win' : 'loss'
  return 'unknown'
}

function readParticipant(participantId: string, participant: Record<string, unknown>, stats: Record<string, unknown>): NormalizedParticipant {
  const team = integerOrNull(participant.teamId)
  const items = readItems(stats)
  const augments = readAugments(stats)
  return {
    participantId,
    teamId: team == null ? null : String(team),
    championId: integerOrNull(participant.championId),
    win: typeof stats.win === 'boolean' ? stats.win : null,
    kills: integerOrNull(stats.kills),
    deaths: integerOrNull(stats.deaths),
    assists: integerOrNull(stats.assists),
    championDamage: integerOrNull(stats.totalDamageDealtToChampions),
    gold: integerOrNull(stats.goldEarned),
    augmentStatus: augments.status,
    augments: augments.augments,
    itemsStatus: items.status,
    items: items.items
  }
}

function readItems(stats: Record<string, unknown>): { status: 'readable' | 'unavailable'; items: NormalizedItem[] } {
  const keys = [0, 1, 2, 3, 4, 5, 6].map((slot) => `item${slot}`)
  if (!keys.every((key) => key in stats)) return { status: 'unavailable', items: [] }
  const items: NormalizedItem[] = []
  for (let slot = 0; slot <= 6; slot += 1) {
    const itemId = integerOrNull(stats[`item${slot}`])
    if (itemId == null || itemId < 0) return { status: 'unavailable', items: [] }
    items.push({ slot, itemId })
  }
  return { status: 'readable', items }
}

function readAugments(stats: Record<string, unknown>): { status: AugmentStatus; augments: NormalizedAugment[] } {
  const keys = [1, 2, 3, 4, 5, 6].map((slot) => `playerAugment${slot}`)
  if (!keys.some((key) => key in stats)) return { status: 'unavailable', augments: [] }
  if (!keys.every((key) => integerOrNull(stats[key]) != null)) return { status: 'invalid', augments: [] }
  const augments: NormalizedAugment[] = []
  for (let slot = 1; slot <= 6; slot += 1) {
    const augmentId = integerOrNull(stats[`playerAugment${slot}`])
    if (augmentId == null || augmentId <= 0) continue
    augments.push({
      selectionSlot: slot,
      augmentId: String(augmentId),
      sourceField: `stats.playerAugment${slot}`,
      orderKnown: true
    })
  }
  return { status: augments.length > 0 ? 'recorded' : 'explicitNone', augments }
}
