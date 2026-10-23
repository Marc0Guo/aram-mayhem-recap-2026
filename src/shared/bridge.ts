import type { DashboardModel, ExportSnapshot, Locale, MatchDetail, MatchSummary } from './types'

export interface ApiError {
  code: string
  message: string
  retryable: boolean
  correlationId: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export interface DiscoveryView {
  state: 'found' | 'missing' | 'stale' | 'malformed' | 'wrong-service' | 'pending' | 'skipped'
  port: number | null
}

export interface Bootstrap {
  mode: 'demo' | 'real'
  offline: boolean
  realClientVerified: boolean
  locale: Locale
  timeZone: string
  imageDownloads: 'auto' | 'never'
  leagueDir: string | null
  storagePath: string
  logPath: string
  activeAccountId: string | null
  accounts: Array<{ accountId: string; alias: string }>
  discovery: DiscoveryView
  schemaBlocked: { found: number; supported: number } | null
  recoveryPath: string | null
  hasCachedMatches: boolean
}

export interface SyncView {
  runId: string
  state: string
  discovered: number
  committed: number
  skipped: number
  failed: number
  accountId: string
}

export interface MatchPage {
  matches: MatchSummary[]
  nextCursor: string | null
  total: number
  pageSize: 50
}

export interface AssetStatus {
  downloadsEnabled: boolean
  pinnedVersion: string | null
  ready: number
  failed: number
}

export interface IconFace {
  name: string
  portrait: string | null
  splash: string | null
  tags: string[]
}

export interface IconTile {
  rarity?: 'silver' | 'gold' | 'prismatic' | 'unknown'
  name: string
  icon: string | null
}

export interface IconCatalog {
  profileIcons?: Record<string, string | null>
  champions: Record<string, IconFace>
  items: Record<string, IconTile>
  augments: Record<string, IconTile>
}

export interface AramApi {
  bootstrap: () => Promise<ApiResult<Bootstrap>>
  dashboardQuery: (input: unknown) => Promise<ApiResult<DashboardModel>>
  matchesList: (input: unknown) => Promise<ApiResult<MatchPage>>
  matchDetail: (input: unknown) => Promise<ApiResult<MatchDetail>>
  syncStart: (input: unknown) => Promise<ApiResult<{ runId: string }>>
  syncCancel: (input: unknown) => Promise<ApiResult<{ runId: string }>>
  assetsStatus: () => Promise<ApiResult<AssetStatus>>
  icons: (input: unknown) => Promise<ApiResult<IconCatalog>>
  exportPng: (input: unknown) => Promise<ApiResult<{ path: string | null; canceled: boolean }>>
  connectLeague: () => Promise<ApiResult<Bootstrap>>
  useDemo: () => Promise<ApiResult<Bootstrap>>
  useReal: () => Promise<ApiResult<Bootstrap>>
  openLeague: () => Promise<ApiResult<{ message: string }>>
  retryDiscovery: () => Promise<ApiResult<DiscoveryView>>
  restoreDatabase: () => Promise<ApiResult<Bootstrap>>
  useFreshDatabase: () => Promise<ApiResult<Bootstrap>>
  getSettings: () => Promise<ApiResult<Bootstrap>>
  updateSettings: (input: unknown) => Promise<ApiResult<Bootstrap>>
  deleteAccount: (input: unknown) => Promise<ApiResult<Bootstrap>>
  chooseLeagueFolder: () => Promise<ApiResult<{ leagueDir: string | null }>>
  openLocation: (kind: 'data' | 'logs') => Promise<ApiResult<{ opened: boolean }>>
  onSyncProgress: (callback: (progress: SyncView) => void) => () => void
}

export interface ExportPayload {
  snapshot: ExportSnapshot
}
