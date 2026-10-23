import type { ActivityDay, AugmentRow, ChampionRow, CoverageGap, CoverageState, EntityFilter, ItemRow, Metric, MetricRow, MetricsResult, ResultState } from './types'
import { eachLocalDate, formatLocalDate, inHalfOpenRange } from './time'

export interface MetricQuery {
  startUtc: number
  endUtc: number
  timeZone: string
  filter?: EntityFilter
  gaps?: CoverageGap[]
  activityStartUtc?: number
  activityEndUtc?: number
  importPartial?: boolean
}

function metric<T>(value: T, eligibleN: number, excludedN: number, coverage: CoverageState, unavailableReason: string | null): Metric<T> {
  return { value, eligibleN, excludedN, coverage, unavailableReason }
}

function percent1(part: number, whole: number): number {
  return Math.round((part * 1000) / whole) / 10
}

function uniqueNonZero(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => id !== 0 && id !== 2052))]
}

function gapBetween(earlier: number, later: number, gaps: CoverageGap[]): boolean {
  return gaps.some((gap) => gap.startUtc < later && gap.endUtc > earlier)
}

export function longestWinStreak(rows: Array<{ startUtc: number; resultState: ResultState }>, gaps: CoverageGap[] = []): number {
  const ordered = [...rows].sort((a, b) => a.startUtc - b.startUtc || 0)
  let best = 0
  let current = 0
  let previous: { startUtc: number } | null = null
  for (const row of ordered) {
    if (previous && gapBetween(previous.startUtc, row.startUtc, gaps)) current = 0
    if (row.resultState === 'win') {
      current += 1
      best = Math.max(best, current)
    } else {
      current = 0
    }
    previous = row
  }
  return best
}

function applyFilter(rows: MetricRow[], filter: EntityFilter | undefined): MetricRow[] {
  if (!filter) return rows
  return rows.filter((row) => {
    if (filter.championId != null && row.championId !== filter.championId) return false
    if (filter.augmentId != null && !row.augmentIds.includes(filter.augmentId)) return false
    if (filter.itemId != null && !uniqueNonZero(row.itemIds).includes(filter.itemId)) return false
    return true
  })
}

export function computeMetrics(rows: MetricRow[], query: MetricQuery): MetricsResult {
  const gaps = query.gaps ?? []
  const inRange = rows.filter(
    (row) => row.modeClass === 'mayhem' && inHalfOpenRange(row.startUtc, query.startUtc, query.endUtc)
  )
  const quarantined = inRange.filter((row) => row.quarantined || row.ingestStatus !== 'complete')
  const healthy = inRange.filter((row) => !row.quarantined && row.ingestStatus === 'complete')
  const filtered = applyFilter(healthy, query.filter)
  const filterExcluded = healthy.length - filtered.length
  const gamesExcluded = quarantined.length + filterExcluded
  const partial = query.importPartial === true
  const gamesCoverage: CoverageState = partial ? 'partial' : 'completeForStored'

  const wins = filtered.filter((row) => row.resultState === 'win').length
  const losses = filtered.filter((row) => row.resultState === 'loss').length
  const remakes = filtered.filter((row) => row.resultState === 'remake').length
  const unknownOutcomes = filtered.filter((row) => row.resultState === 'unknown').length
  const decided = wins + losses
  const winRateValue = decided === 0 ? null : percent1(wins, decided)

  const playable = filtered.filter((row) => row.durationSeconds != null && row.durationSeconds > 0)
  const playtime = playable.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)

  const kdaRows = filtered.filter((row) => row.kills != null && row.deaths != null && row.assists != null)
  const kdaExcluded = filtered.length - kdaRows.length
  const sumKills = kdaRows.reduce((sum, row) => sum + (row.kills ?? 0), 0)
  const sumDeaths = kdaRows.reduce((sum, row) => sum + (row.deaths ?? 0), 0)
  const sumAssists = kdaRows.reduce((sum, row) => sum + (row.assists ?? 0), 0)
  const numerator = sumKills + sumAssists
  const perfect = kdaRows.length > 0 && sumDeaths === 0
  const kdaValue = kdaRows.length === 0 ? null : perfect ? null : Math.round((numerator / Math.max(1, sumDeaths)) * 100) / 100

  const damageRows = filtered.filter(
    (row) => row.championDamage != null && row.durationSeconds != null && row.durationSeconds > 0
  )
  const damageSum = damageRows.reduce((sum, row) => sum + (row.championDamage ?? 0), 0)
  const damageMinutes = damageRows.reduce((sum, row) => sum + (row.durationSeconds ?? 0) / 60, 0)
  const damagePerMin = damageRows.length === 0 || damageMinutes === 0 ? null : Math.round((damageSum / damageMinutes) * 10) / 10

  const knownChampion = filtered.filter((row) => row.championId != null)
  const byChampion = new Map<number, MetricRow[]>()
  for (const row of knownChampion) {
    const id = row.championId as number
    const list = byChampion.get(id) ?? []
    list.push(row)
    byChampion.set(id, list)
  }
  const champions: ChampionRow[] = [...byChampion.entries()].map(([championId, list]) => {
    const champWins = list.filter((row) => row.resultState === 'win').length
    const champLosses = list.filter((row) => row.resultState === 'loss').length
    const decidedChamp = champWins + champLosses
    const champKda = list.filter((row) => row.kills != null && row.deaths != null && row.assists != null)
    const kills = champKda.reduce((sum, row) => sum + (row.kills ?? 0), 0)
    const deaths = champKda.reduce((sum, row) => sum + (row.deaths ?? 0), 0)
    const assists = champKda.reduce((sum, row) => sum + (row.assists ?? 0), 0)
    const champPerfect = champKda.length > 0 && deaths === 0
    return {
      championId,
      games: list.length,
      wins: champWins,
      losses: champLosses,
      winRate: decidedChamp === 0 ? null : percent1(champWins, decidedChamp),
      kda: champKda.length === 0 || champPerfect ? null : Math.round(((kills + assists) / Math.max(1, deaths)) * 100) / 100,
      perfect: champPerfect,
      kdaEligibleN: champKda.length,
      kdaExcludedN: list.length - champKda.length
    }
  })
  champions.sort((a, b) => b.games - a.games || b.wins - a.wins || a.championId - b.championId)

  const usableAugments = filtered.filter((row) => row.augmentStatus === 'recorded' || row.augmentStatus === 'explicitNone')
  const unknownAugments = filtered.filter((row) => row.augmentStatus === 'unavailable' || row.augmentStatus === 'invalid')
  const augmentCounts = new Map<string, number>()
  for (const row of usableAugments) {
    for (const id of new Set(row.augmentIds)) {
      augmentCounts.set(id, (augmentCounts.get(id) ?? 0) + 1)
    }
  }
  const augmentRows: AugmentRow[] = [...augmentCounts.entries()]
    .map(([augmentId, count]) => ({
      augmentId,
      count,
      percent: usableAugments.length === 0 ? 0 : percent1(count, usableAugments.length)
    }))
    .sort((a, b) => b.count - a.count || a.augmentId.localeCompare(b.augmentId))
  const augmentCoverage: CoverageState =
    usableAugments.length === 0 ? 'unavailable' : unknownAugments.length > 0 || partial ? 'partial' : 'completeForStored'

  const readableItems = filtered.filter((row) => row.itemsStatus === 'readable')
  const unknownItems = filtered.length - readableItems.length
  const itemCounts = new Map<number, number>()
  for (const row of readableItems) {
    for (const id of uniqueNonZero(row.itemIds)) {
      itemCounts.set(id, (itemCounts.get(id) ?? 0) + 1)
    }
  }
  const itemRows: ItemRow[] = [...itemCounts.entries()]
    .map(([itemId, count]) => ({
      itemId,
      count,
      percent: readableItems.length === 0 ? 0 : percent1(count, readableItems.length)
    }))
    .sort((a, b) => b.count - a.count || a.itemId - b.itemId)
  const itemCoverage: CoverageState =
    readableItems.length === 0 ? 'unavailable' : unknownItems > 0 || partial ? 'partial' : 'completeForStored'

  const span = query.endUtc - query.startUtc
  const dataMin = filtered.reduce((min, row) => Math.min(min, row.startUtc), Number.POSITIVE_INFINITY)
  const dataMax = filtered.reduce((max, row) => Math.max(max, row.startUtc), 0)
  let activityStart = query.activityStartUtc ?? query.startUtc
  let activityEnd = query.activityEndUtc ?? query.endUtc
  if (!Number.isFinite(span) || span > 400 * 24 * 60 * 60 * 1000) {
    if (filtered.length > 0) {
      activityStart = dataMin
      activityEnd = dataMax + 1
    } else {
      activityStart = query.startUtc
      activityEnd = query.startUtc
    }
  }
  const dayKeys = filtered.length === 0 && (activityEnd <= activityStart) ? [] : eachLocalDate(activityStart, activityEnd, query.timeZone)
  const activityMap = new Map<string, ActivityDay>(dayKeys.map((date) => [date, { date, games: 0, wins: 0, losses: 0 }]))
  for (const row of filtered) {
    const date = formatLocalDate(row.startUtc, query.timeZone)
    const cell = activityMap.get(date) ?? { date, games: 0, wins: 0, losses: 0 }
    cell.games += 1
    if (row.resultState === 'win') cell.wins += 1
    if (row.resultState === 'loss') cell.losses += 1
    activityMap.set(date, cell)
  }
  const activity = [...activityMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const rateCoverage = (eligible: number): CoverageState => {
    if (eligible === 0) return filtered.length === 0 && !partial ? 'completeForStored' : 'unavailable'
    return partial ? 'partial' : 'completeForStored'
  }

  return {
    games: metric(filtered.length, filtered.length, gamesExcluded, filtered.length === 0 && partial ? 'partial' : gamesCoverage, null),
    wins: metric(wins, filtered.length, gamesExcluded, gamesCoverage, null),
    losses: metric(losses, filtered.length, gamesExcluded, gamesCoverage, null),
    remakes: metric(remakes, filtered.length, gamesExcluded, gamesCoverage, null),
    unknownOutcomes: metric(unknownOutcomes, filtered.length, gamesExcluded, gamesCoverage, null),
    winRate: {
      ...metric(winRateValue, decided, filtered.length - decided, rateCoverage(decided), decided === 0 ? 'empty-denominator' : null),
      wins,
      losses
    },
    playtimeSeconds: metric(
      playable.length === 0 ? null : playtime,
      playable.length,
      filtered.length - playable.length,
      rateCoverage(playable.length),
      playable.length === 0 ? 'no-duration' : null
    ),
    aggregateKda: {
      ...metric(kdaValue, kdaRows.length, kdaExcluded, rateCoverage(kdaRows.length), kdaRows.length === 0 ? 'empty-denominator' : null),
      perfect,
      numerator: kdaRows.length === 0 ? null : numerator,
      deaths: kdaRows.length === 0 ? null : sumDeaths
    },
    damagePerMin: metric(
      damagePerMin,
      damageRows.length,
      filtered.length - damageRows.length,
      rateCoverage(damageRows.length),
      damageRows.length === 0 ? 'no-damage-duration' : null
    ),
    favoriteChampionId: champions[0]?.championId ?? null,
    champions,
    championEligibleN: knownChampion.length,
    championExcludedN: filtered.length - knownChampion.length,
    augments: {
      rows: augmentRows,
      recordedMatches: usableAugments.length,
      totalMatches: filtered.length,
      unknownMatches: unknownAugments.length,
      coverage: augmentCoverage,
      unavailableReason: usableAugments.length === 0 ? 'augments-unavailable' : null
    },
    items: {
      rows: itemRows,
      readableMatches: readableItems.length,
      totalMatches: filtered.length,
      unknownMatches: unknownItems,
      coverage: itemCoverage,
      unavailableReason: readableItems.length === 0 ? 'items-unavailable' : null
    },
    activity,
    longestWinStreak: longestWinStreak(filtered, gaps),
    quarantined: quarantined.length
  }
}
