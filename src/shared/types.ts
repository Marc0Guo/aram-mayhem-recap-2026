import type { PosterFacts } from './match-facts'

export const LOCALES = ['zh-CN', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const PRESETS = ['last7', 'last30', 'lastWeek', 'thisYear', 'all', 'custom'] as const
export type DatePreset = (typeof PRESETS)[number]

export const MODE_CLASSES = ['mayhem', 'aram', 'unconfirmed', 'unknown'] as const
export type ModeClass = (typeof MODE_CLASSES)[number]

export const RESULT_STATES = ['win', 'loss', 'remake', 'unknown'] as const
export type ResultState = (typeof RESULT_STATES)[number]

export const AUGMENT_STATUSES = ['recorded', 'explicitNone', 'unavailable', 'invalid'] as const
export type AugmentStatus = (typeof AUGMENT_STATUSES)[number]

export const INGEST_STATUSES = ['complete', 'incomplete', 'unavailable', 'quarantined'] as const
export type IngestStatus = (typeof INGEST_STATUSES)[number]

export const COVERAGE_STATES = ['completeForStored', 'partial', 'unavailable'] as const
export type CoverageState = (typeof COVERAGE_STATES)[number]

export interface EntityFilter {
  championId: number | null
  augmentId: string | null
  itemId: number | null
}

export interface Metric<T> {
  value: T
  eligibleN: number
  excludedN: number
  coverage: CoverageState
  unavailableReason: string | null
}

export interface KdaMetric extends Metric<number | null> {
  perfect: boolean
  numerator: number | null
  deaths: number | null
}

export interface WinRateMetric extends Metric<number | null> {
  wins: number
  losses: number
}

export interface ChampionRow {
  championId: number
  games: number
  wins: number
  losses: number
  winRate: number | null
  kda: number | null
  perfect: boolean
  kdaEligibleN: number
  kdaExcludedN: number
}

export interface AugmentRow {
  augmentId: string
  count: number
  percent: number
}

export interface ItemRow {
  itemId: number
  count: number
  percent: number
}

export interface ActivityDay {
  date: string
  games: number
  wins: number
  losses: number
}

export interface CoverageGap {
  startUtc: number
  endUtc: number
}

export interface MetricRow {
  platformId: string
  gameId: string
  startUtc: number
  durationSeconds: number | null
  resultState: ResultState
  championId: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  championDamage: number | null
  augmentStatus: AugmentStatus
  augmentIds: string[]
  itemsStatus: 'readable' | 'unavailable'
  itemIds: number[]
  quarantined: boolean
  ingestStatus: IngestStatus
  modeClass: ModeClass
  selfParticipantId: string | null
}

export interface MetricsResult {
  games: Metric<number>
  wins: Metric<number>
  losses: Metric<number>
  remakes: Metric<number>
  unknownOutcomes: Metric<number>
  winRate: WinRateMetric
  playtimeSeconds: Metric<number | null>
  aggregateKda: KdaMetric
  damagePerMin: Metric<number | null>
  favoriteChampionId: number | null
  champions: ChampionRow[]
  championEligibleN: number
  championExcludedN: number
  augments: {
    rows: AugmentRow[]
    recordedMatches: number
    totalMatches: number
    unknownMatches: number
    coverage: CoverageState
    unavailableReason: string | null
  }
  items: {
    rows: ItemRow[]
    readableMatches: number
    totalMatches: number
    unknownMatches: number
    coverage: CoverageState
    unavailableReason: string | null
  }
  activity: ActivityDay[]
  longestWinStreak: number
  quarantined: number
}

export interface NormalizedAugment {
  selectionSlot: number
  augmentId: string
  sourceField: string
  orderKnown: boolean
}

export interface NormalizedItem {
  slot: number
  itemId: number
}

export interface NormalizedParticipant {
  participantId: string
  teamId: string | null
  championId: number | null
  win: boolean | null
  kills: number | null
  deaths: number | null
  assists: number | null
  championDamage: number | null
  gold: number | null
  augmentStatus: AugmentStatus
  augments: NormalizedAugment[]
  itemsStatus: 'readable' | 'unavailable'
  items: NormalizedItem[]
}

export interface NormalizedMatch {
  platformId: string
  gameId: string
  queueId: number | null
  modeClass: ModeClass
  classificationVersion: string
  startUtc: number
  durationSeconds: number | null
  resultState: ResultState
  patch: string | null
  ingestStatus: IngestStatus
  adapterVersion: string
  selfParticipantId: string | null
  participants: NormalizedParticipant[]
  raw: unknown
  sourceSchema: string
  quarantineReason?: string
}

export interface ListedMatch {
  platformId: string
  gameId: string
  queueId: number | null
  startUtc: number | null
}

export type EmptyKind = 'none' | 'no-matches-in-range' | 'no-stored-history' | 'filtered-empty'

export interface OwnedChallenge {
  id: string
  name: string
  description: string
  level: string
  value: number
  percentile: number | null
  rank: number | null
}

export interface AccountProfile {
  challenges?: OwnedChallenge[]
  profileIconId: number | null
  level: number | null
  region: string
  spellKeys: [string | null, string | null]
  movementMode?: 'mouse' | 'wasd' | 'unknown'
  spellBindingVersion?: 2
  masteryScore: number | null
  mastery: Record<string, { level: number; points: number }>
  updatedAt: number
}

export interface DashboardModel {
  profile?: AccountProfile | null
  accountAlias: string
  mode: 'demo' | 'real'
  realClientVerified: boolean
  badge: 'demo' | 'local'
  locale: Locale
  timeZone: string
  preset: DatePreset
  rangeLabel: string
  startUtc: number
  endUtc: number
  lastScanLabel: string
  earliestStoredLabel: string
  coverageCopy: string
  emptyKind: EmptyKind
  notices: string[]
  gamesText: string
  winsText: string
  lossesText: string
  remakesText: string
  unknownOutcomesText: string
  winRateText: string
  winRateDetail: string
  playtimeText: string
  playtimeDetail: string
  kdaText: string
  kdaDetail: string
  damageText: string
  damageDetail: string
  favoriteText: string
  favoriteDetail: string
  streakText: string
  championSummary: string
  augmentSummary: string
  itemSummary: string
  activitySummary: string
  activityCaption: string
  champions: Array<ChampionRow & { name: string; winRateText: string; kdaText: string }>
  augments: {
    available: boolean
    rows: Array<AugmentRow & { name: string; label: string }>
    coverageText: string
    note: string
  }
  items: {
    available: boolean
    rows: Array<ItemRow & { name: string; label: string }>
    coverageText: string
    note: string
  }
  activity: ActivityDay[]
  metrics: MetricsResult
  poster: PosterFacts
}

export interface MatchSummary {
  platformId: string
  gameId: string
  championId: number | null
  championName: string
  startUtc: number
  startLabel: string
  resultState: ResultState
  resultLabel: string
  durationSeconds: number | null
  durationLabel: string
  kdaLabel: string
  damageLabel: string
  items: NormalizedItem[]
  augments: NormalizedAugment[]
  augmentStatus: AugmentStatus
}

export interface MatchDetail extends MatchSummary {
  patch: string | null
  queueId: number | null
  gold: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  championDamage: number | null
  participants: Array<{
    participantId: string
    teamId: string | null
    championId: number | null
    championName: string
    self: boolean
    resultLabel: string
    kdaLabel: string
  }>
}

export interface ExportSnapshot {
  width: 1600
  height: 2000
  title: string
  alias: string | null
  rangeLabel: string
  timeZone: string
  gamesText: string
  recordText: string
  winRateText: string
  playtimeText: string
  favoriteText: string
  streakText: string
  augments: { available: boolean; lines: string[]; note: string }
  items: { available: boolean; lines: string[]; note: string }
  coverageFooter: string
  attribution: string
  demoWatermark: boolean
  placeholders: boolean
  emptyPeriod: boolean
  activityCaption: string
}
