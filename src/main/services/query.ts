import { REAL_CLIENT_IMPORT_VERIFIED } from '@shared/allowlist'
import { championName } from '@shared/catalog'
import { presentDashboard, resultLabel, formatDuration, kdaLabel, buildExportSnapshot } from '@shared/present'
import type { RangeInput } from '@shared/schemas'
import { buildPosterFacts, readStoredGame, type PosterFacts } from '@shared/match-facts'
import { computeMetrics } from '@shared/metrics'
import { t } from '@shared/i18n'
import type { MetricRow } from '@shared/types'
import { resolvePreset } from '@shared/time'
import type { ExportSnapshot, MatchDetail, MatchSummary } from '@shared/types'
import { decodeCursor, encodeCursor, type WrappedDatabase } from '../db/repository'

export interface QueryContext {
  mode: 'demo' | 'real'
  clientUnavailable: boolean
}

function rangeFor(input: RangeInput) {
  return resolvePreset({
    preset: input.preset,
    nowUtc: Date.now(),
    timeZone: input.timeZone,
    customStart: input.customStart,
    customEnd: input.customEnd
  })
}

export function queryDashboard(db: WrappedDatabase, input: RangeInput, context: QueryContext) {
  const range = rangeFor(input)
  const rows = db.loadMayhemRows(input.accountId, range.startUtc, range.endUtc)
  const summary = db.storageSummary(input.accountId)
  const sync = db.readSyncState(input.accountId)
  const account = db.getAccount(input.accountId)
  const filtered = input.championId != null || input.augmentId != null || input.itemId != null
  const metrics = computeMetrics(rows, {
    startUtc: range.startUtc,
    endUtc: range.endUtc,
    timeZone: input.timeZone,
    filter: { championId: input.championId, augmentId: input.augmentId, itemId: input.itemId },
    gaps: sync?.continuation.gaps ?? [],
    importPartial: context.mode === 'real' && sync?.continuation.partial === true
  })
  return presentDashboard({
    metrics,
    locale: input.locale,
    mode: context.mode,
    realClientVerified: REAL_CLIENT_IMPORT_VERIFIED,
    alias: account?.alias ?? '',
    preset: input.preset,
    timeZone: input.timeZone,
    startUtc: range.startUtc,
    endUtc: range.endUtc,
    startDate: range.startDate,
    endDate: range.endDate,
    lastSuccessfulScan: sync?.lastSuccessfulScan ?? null,
    earliestStored: summary.earliest,
    storedMatches: summary.stored,
    verifiedMayhem: summary.mayhemComplete,
    unverifiedStored: summary.unverified,
    importPartial: context.mode === 'real' && sync?.continuation.partial === true,
    clientUnavailable: context.clientUnavailable,
    filtered,
    profile: readProfile(db, input.accountId),
    poster: posterFor(db, rows, input)
  })
}

export function queryExport(db: WrappedDatabase, input: RangeInput & { title: string; includeAlias: boolean }, context: QueryContext): ExportSnapshot {
  const range = rangeFor(input)
  const rows = db.loadMayhemRows(input.accountId, range.startUtc, range.endUtc)
  const summary = db.storageSummary(input.accountId)
  const sync = db.readSyncState(input.accountId)
  const account = db.getAccount(input.accountId)
  const metrics = computeMetrics(rows, {
    startUtc: range.startUtc,
    endUtc: range.endUtc,
    timeZone: input.timeZone,
    filter: { championId: input.championId, augmentId: input.augmentId, itemId: input.itemId },
    gaps: sync?.continuation.gaps ?? [],
    importPartial: context.mode === 'real' && sync?.continuation.partial === true
  })
  return buildExportSnapshot({
    metrics,
    locale: input.locale,
    mode: context.mode,
    realClientVerified: REAL_CLIENT_IMPORT_VERIFIED,
    alias: account?.alias ?? '',
    preset: input.preset,
    timeZone: input.timeZone,
    startUtc: range.startUtc,
    endUtc: range.endUtc,
    startDate: range.startDate,
    endDate: range.endDate,
    lastSuccessfulScan: sync?.lastSuccessfulScan ?? null,
    earliestStored: summary.earliest,
    storedMatches: summary.stored,
    verifiedMayhem: summary.mayhemComplete,
    unverifiedStored: summary.unverified,
    importPartial: context.mode === 'real' && sync?.continuation.partial === true,
    clientUnavailable: context.clientUnavailable,
    filtered: input.championId != null || input.augmentId != null || input.itemId != null,
    title: input.title,
    includeAlias: input.includeAlias,
    profile: readProfile(db, input.accountId),
    poster: posterFor(db, rows, input)
  })
}

export function queryMatches(db: WrappedDatabase, input: RangeInput & { cursor: string | null }): { matches: MatchSummary[]; nextCursor: string | null; total: number; pageSize: 50 } {
  const range = rangeFor(input)
  const account = db.getAccount(input.accountId)
  const mode = account?.platformId === 'DEMO' ? 'demo' : 'real'
  const page = db.listMatches({
    accountId: input.accountId,
    startUtc: range.startUtc,
    endUtc: range.endUtc,
    championId: input.championId,
    augmentId: input.augmentId,
    itemId: input.itemId,
    cursor: input.cursor ? decodeCursor(input.cursor) : null,
    limit: 51
  })
  const hasMore = page.rows.length > 50
  const visible = page.rows.slice(0, 50)
  const matches = visible.map((row) => toSummary(db, row, input.locale, input.timeZone, mode))
  const last = matches[matches.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.startUtc, last.gameId) : null
  return { matches, nextCursor, total: page.total, pageSize: 50 }
}

export function queryDetail(db: WrappedDatabase, input: { accountId: string; platformId: string; gameId: string; locale: 'zh-CN' | 'en'; timeZone: string }): MatchDetail | null {
  const account = db.getAccount(input.accountId)
  if (!account) return null
  const row = db.getOwnedMatch(input.accountId, input.platformId, input.gameId)
  if (!row) return null
  const mode = account.platformId === 'DEMO' ? 'demo' : 'real'
  return detailFrom(db, row, input.locale, input.timeZone, mode)
}

function posterFor(db: WrappedDatabase, rows: MetricRow[], input: RangeInput): PosterFacts {
  const visible = rows.filter((row) => {
    if (row.modeClass !== 'mayhem' || row.quarantined || row.ingestStatus !== 'complete') return false
    if (input.championId != null && row.championId !== input.championId) return false
    if (input.augmentId != null && !row.augmentIds.includes(input.augmentId)) return false
    if (input.itemId != null && !row.itemIds.some((itemId) => itemId !== 0 && itemId === input.itemId)) return false
    return true
  })
  return buildPosterFacts(visible.map((row) => readStoredGame({
    startUtc: row.startUtc,
    championId: row.championId,
    resultState: row.resultState,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    championDamage: row.championDamage,
    durationSeconds: row.durationSeconds,
    selfParticipantId: row.selfParticipantId,
    raw: parseRaw(db.rawPayload(row.platformId, row.gameId))
  })), input.locale, t(input.locale, 'perfect'), input.timeZone)
}

function parseRaw(payload: string | null): unknown {
  if (!payload) return null
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return null
  }
}

function toSummary(db: WrappedDatabase, row: Record<string, unknown>, locale: 'zh-CN' | 'en', timeZone: string, mode: 'demo' | 'real'): MatchSummary {
  const platformId = String(row.platform_id)
  const gameId = String(row.game_id)
  const participantId = String(row.participant_id)
  const children = db.matchChildren(platformId, gameId, participantId)
  const resultState = row.result_state === 'win' || row.result_state === 'loss' || row.result_state === 'remake' ? row.result_state : 'unknown'
  const championId = typeof row.champion_id === 'number' ? row.champion_id : null
  const startUtc = Number(row.start_utc)
  const durationSeconds = typeof row.duration_seconds === 'number' ? row.duration_seconds : null
  const kills = typeof row.kills === 'number' ? row.kills : null
  const deaths = typeof row.deaths === 'number' ? row.deaths : null
  const assists = typeof row.assists === 'number' ? row.assists : null
  const damage = typeof row.champion_damage === 'number' ? row.champion_damage : null
  return {
    platformId,
    gameId,
    championId,
    championName: championName(championId, locale, mode),
    startUtc,
    startLabel: new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(startUtc)),
    resultState,
    resultLabel: resultLabel(resultState, locale),
    durationSeconds,
    durationLabel: formatDuration(durationSeconds, locale),
    kdaLabel: kdaLabel(kills, deaths, assists),
    damageLabel: damage == null ? '—' : String(damage),
    items: children.items,
    augments: children.augments,
    augmentStatus: row.augment_status === 'recorded' || row.augment_status === 'explicitNone' || row.augment_status === 'invalid' ? row.augment_status : 'unavailable'
  }
}

function detailFrom(db: WrappedDatabase, row: Record<string, unknown>, locale: 'zh-CN' | 'en', timeZone: string, mode: 'demo' | 'real'): MatchDetail {
  const summary = toSummary(db, row, locale, timeZone, mode)
  const participants = db.listParticipants(summary.platformId, summary.gameId).map((participant) => {
    const championId = typeof participant.champion_id === 'number' ? participant.champion_id : null
    const win = participant.win == null ? 'unknown' : participant.win === 1 ? 'win' : 'loss'
    return {
      participantId: String(participant.participant_id),
      teamId: participant.team_id == null ? null : String(participant.team_id),
      championId,
      championName: championName(championId, locale, mode),
      self: String(participant.participant_id) === String(row.participant_id),
      resultLabel: resultLabel(win, locale),
      kdaLabel: kdaLabel(
        typeof participant.kills === 'number' ? participant.kills : null,
        typeof participant.deaths === 'number' ? participant.deaths : null,
        typeof participant.assists === 'number' ? participant.assists : null
      )
    }
  })
  return {
    ...summary,
    patch: row.patch == null ? null : String(row.patch),
    queueId: typeof row.queue_id === 'number' ? row.queue_id : null,
    gold: typeof row.gold === 'number' ? row.gold : null,
    kills: typeof row.kills === 'number' ? row.kills : null,
    deaths: typeof row.deaths === 'number' ? row.deaths : null,
    assists: typeof row.assists === 'number' ? row.assists : null,
    championDamage: typeof row.champion_damage === 'number' ? row.champion_damage : null,
    participants
  }
}

function readProfile(db: WrappedDatabase, accountId: string): import('@shared/types').AccountProfile | null { try { const value = db.getSetting(`profile:${accountId}`); return value ? JSON.parse(value) : null } catch { return null } }
