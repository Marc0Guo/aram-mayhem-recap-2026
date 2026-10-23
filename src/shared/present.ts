import { augmentName, championName, itemName } from './catalog'
import { t } from './i18n'
import type { PosterFacts } from './match-facts'
import type { DashboardModel, DatePreset, EmptyKind, ExportSnapshot, Locale, MatchSummary, MetricsResult } from './types'
import { formatLocalDateTime } from './time'

export function resultLabel(result: MatchSummary['resultState'], locale: Locale): string {
  if (result === 'win') return t(locale, 'win')
  if (result === 'loss') return t(locale, 'loss')
  if (result === 'remake') return t(locale, 'remake')
  return t(locale, 'unknown')
}

export function formatDuration(seconds: number | null, locale: Locale): string {
  if (seconds == null) return '—'
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (locale === 'zh-CN') return `${minutes}分${String(remain).padStart(2, '0')}秒`
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

export function formatPlaytime(seconds: number | null, locale: Locale): string {
  if (seconds == null) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (locale === 'zh-CN') return `${hours}小时${minutes}分`
  return `${hours}h ${minutes}m`
}

export function formatWinRate(wins: number, losses: number, locale: Locale): string {
  const denominator = wins + losses
  if (denominator === 0) return '—'
  const value = (Math.round((wins * 1000) / denominator) / 10).toFixed(1)
  return locale === 'zh-CN' ? `${value}%（${wins}/${denominator}）` : `${value}% (${wins}/${denominator})`
}

export function formatKda(value: number | null, perfect: boolean, locale: Locale): string {
  if (perfect) return t(locale, 'perfect')
  if (value == null) return '—'
  return String(value)
}

export function formatDamage(value: number | null, locale: Locale): string {
  if (value == null) return '—'
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return locale === 'zh-CN' ? `${text}/分钟` : `${text}/min`
}

export function kdaLabel(kills: number | null, deaths: number | null, assists: number | null): string {
  if (kills == null || deaths == null || assists == null) return '—'
  return `${kills}/${deaths}/${assists}`
}

export function rangeLabel(preset: DatePreset, startDate: string, endDate: string, timeZone: string, locale: Locale): string {
  if (preset === 'all') return `${t(locale, 'allStoredRange')} · ${timeZone}`
  return `${startDate} – ${endDate} · ${timeZone}`
}

export interface PresentInput {
  profile?: import('./types').AccountProfile | null
  metrics: MetricsResult
  locale: Locale
  mode: 'demo' | 'real'
  realClientVerified: boolean
  alias: string
  preset: DatePreset
  timeZone: string
  startUtc: number
  endUtc: number
  startDate: string
  endDate: string
  lastSuccessfulScan: number | null
  earliestStored: number | null
  storedMatches: number
  verifiedMayhem: number
  unverifiedStored: number
  importPartial: boolean
  clientUnavailable: boolean
  filtered: boolean
  poster: PosterFacts
}

function noticesFor(input: PresentInput): string[] {
  const notes: string[] = []
  if (input.mode === 'demo' || !input.realClientVerified) notes.push('demo-only')
  if (input.clientUnavailable && input.mode === 'real') notes.push('client-unavailable')
  if (input.importPartial) notes.push('partial-import')
  if (input.unverifiedStored > 0 && input.verifiedMayhem === 0) notes.push('unverified-import')
  return notes
}

function emptyKindFor(input: PresentInput): EmptyKind {
  if (input.metrics.games.value > 0) return 'none'
  if (input.filtered && input.verifiedMayhem > 0) return 'filtered-empty'
  if (input.storedMatches === 0) return 'no-stored-history'
  return 'no-matches-in-range'
}

export function presentDashboard(input: PresentInput): DashboardModel {
  const { metrics, locale, mode } = input
  const champions = metrics.champions.map((row) => ({
    ...row,
    name: championName(row.championId, locale, mode),
    winRateText: formatWinRate(row.wins, row.losses, locale),
    kdaText: formatKda(row.kda, row.perfect, locale)
  }))
  const favorite = champions[0]
  const augmentRows = metrics.augments.rows.map((row) => ({
    ...row,
    name: augmentName(row.augmentId, locale, mode),
    label: `${row.count}/${metrics.augments.recordedMatches} (${row.percent.toFixed(1)}%)`
  }))
  const itemRows = metrics.items.rows.map((row) => ({
    ...row,
    name: itemName(row.itemId, locale, mode),
    label: `${row.count}/${metrics.items.readableMatches} (${row.percent.toFixed(1)}%)`
  }))
  const championSummary = champions.length
    ? champions.map((row) => `${row.name} ${row.games}${t(locale, 'gamesUnit')} ${row.winRateText} KDA ${row.kdaText}`).join(locale === 'zh-CN' ? '。' : '. ')
    : t(locale, 'noChampionData')
  const augmentSummary = metrics.augments.recordedMatches === 0
    ? t(locale, 'augmentUnavailable')
    : augmentRows.map((row) => `${row.name} ${row.label}`).join(locale === 'zh-CN' ? '。' : '. ')
      + ` ${t(locale, 'recordedCoverage')} ${metrics.augments.recordedMatches}/${metrics.augments.totalMatches}`
  const itemSummary = metrics.items.readableMatches === 0
    ? t(locale, 'itemsUnavailable')
    : itemRows.map((row) => `${row.name} ${row.label}`).join(locale === 'zh-CN' ? '。' : '. ')
  const activitySummary = metrics.activity
    .filter((day) => day.games > 0)
    .map((day) => `${day.date} ${day.games}`)
    .join(', ') || t(locale, 'activityCaption')
  const scanLabel = input.mode === 'demo'
    ? t(locale, 'demoPrepared')
    : input.lastSuccessfulScan == null
      ? t(locale, 'neverScanned')
      : formatLocalDateTime(input.lastSuccessfulScan, input.timeZone, locale)
  const earliestLabel = input.earliestStored == null
    ? t(locale, 'noEarliest')
    : formatLocalDateTime(input.earliestStored, input.timeZone, locale)

  return {
    accountAlias: input.alias,
    profile: input.profile ?? null,
    mode,
    realClientVerified: input.realClientVerified,
    badge: mode === 'demo' ? 'demo' : 'local',
    locale,
    timeZone: input.timeZone,
    preset: input.preset,
    rangeLabel: rangeLabel(input.preset, input.startDate, input.endDate, input.timeZone, locale),
    startUtc: input.startUtc,
    endUtc: input.endUtc,
    lastScanLabel: scanLabel,
    earliestStoredLabel: earliestLabel,
    coverageCopy: t(locale, 'coverageLimited'),
    emptyKind: emptyKindFor(input),
    notices: noticesFor(input),
    gamesText: String(metrics.games.value),
    winsText: String(metrics.wins.value),
    lossesText: String(metrics.losses.value),
    remakesText: String(metrics.remakes.value),
    unknownOutcomesText: String(metrics.unknownOutcomes.value),
    winRateText: formatWinRate(metrics.winRate.wins, metrics.winRate.losses, locale),
    winRateDetail: `${t(locale, 'eligible')} ${metrics.winRate.eligibleN}`,
    playtimeText: formatPlaytime(metrics.playtimeSeconds.value, locale),
    playtimeDetail: `${t(locale, 'eligible')} ${metrics.playtimeSeconds.eligibleN}`,
    kdaText: formatKda(metrics.aggregateKda.value, metrics.aggregateKda.perfect, locale),
    kdaDetail: metrics.aggregateKda.numerator == null
      ? t(locale, 'kdaUnknown')
      : `${metrics.aggregateKda.numerator} / ${t(locale, 'eligible')} ${metrics.aggregateKda.eligibleN}`,
    damageText: formatDamage(metrics.damagePerMin.value, locale),
    damageDetail: `${t(locale, 'eligible')} ${metrics.damagePerMin.eligibleN}`,
    favoriteText: favorite ? favorite.name : '—',
    favoriteDetail: favorite ? `${favorite.games} ${t(locale, 'gamesUnit')}` : t(locale, 'favoriteMeans'),
    streakText: String(metrics.longestWinStreak),
    championSummary,
    augmentSummary,
    itemSummary,
    activitySummary,
    activityCaption: t(locale, 'activityCaption'),
    champions,
    augments: {
      available: metrics.augments.recordedMatches > 0,
      rows: augmentRows,
      coverageText: `${metrics.augments.recordedMatches}/${metrics.augments.totalMatches}`,
      note: t(locale, 'noAugmentRanking')
    },
    items: {
      available: metrics.items.readableMatches > 0,
      rows: itemRows,
      coverageText: `${metrics.items.readableMatches}/${metrics.items.totalMatches}`,
      note: t(locale, 'finalInventory')
    },
    activity: metrics.activity,
    metrics,
    poster: input.poster
  }
}

export function buildExportSnapshot(input: PresentInput & { title: string; includeAlias: boolean }): ExportSnapshot {
  const dash = presentDashboard(input)
  return {
    width: 1600,
    height: 2000,
    title: input.title.trim() || t(input.locale, 'storyTitle'),
    alias: input.includeAlias ? input.alias : null,
    rangeLabel: dash.rangeLabel,
    timeZone: input.timeZone,
    gamesText: dash.gamesText,
    recordText: `${dash.winsText}${t(input.locale, 'wins')} ${dash.lossesText}${t(input.locale, 'losses')}`,
    winRateText: dash.winRateText,
    playtimeText: dash.playtimeText,
    favoriteText: dash.favoriteText,
    streakText: dash.streakText,
    augments: {
      available: dash.augments.available,
      lines: dash.augments.available ? dash.augments.rows.slice(0, 6).map((row) => `${row.name} ${row.label}`) : [],
      note: dash.augments.available ? `${t(input.locale, 'recordedCoverage')} ${dash.augments.coverageText}. ${dash.augments.note}` : t(input.locale, 'augmentUnavailable')
    },
    items: {
      available: dash.items.available,
      lines: dash.items.available ? dash.items.rows.slice(0, 8).map((row) => `${row.name} ${row.label}`) : [],
      note: dash.items.available ? dash.items.note : t(input.locale, 'itemsUnavailable')
    },
    coverageFooter: dash.rangeLabel,
    attribution: t(input.locale, 'attribution'),
    demoWatermark: input.mode === 'demo' || !input.realClientVerified,
    placeholders: true,
    emptyPeriod: dash.emptyKind !== 'none',
    activityCaption: dash.activityCaption
  }
}
