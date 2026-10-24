import { refreshAccountProfile } from './services/profile'
import fs from 'node:fs'
import path from 'node:path'
import { CANDIDATE_ADAPTER_VERSION, REAL_CLIENT_IMPORT_VERIFIED } from '@shared/allowlist'
import type { Bootstrap, DiscoveryView, IconCatalog, SyncView } from '@shared/bridge'
import type { ExportInput, RangeInput, SettingsInput } from '@shared/schemas'
import { systemTimeZone } from '@shared/time'
import type { ExportSnapshot } from '@shared/types'
import { adaptCandidateDetail, adaptCandidateList } from './lcu/adapter'
import { discoverInstall, readLockfile, windowsPidIsLeague } from './lcu/discover'
import { createLiveTransport, type LcuConnection } from './lcu/session'
import { Logger } from './logger'
import { layoutFromRoot, resolveRoots, type AppPaths } from './paths'
import { seedDemo } from './demo/seed'
import { openWrappedDatabase } from './db/open'
import type { WrappedDatabase } from './db/repository'
import { resolveGameIcons, type IconQuery } from './assets/icons'
import { queryDashboard, queryDetail, queryExport, queryMatches } from './services/query'
import { decideStart, launchMode, runSync, type SyncRunResult } from './sync/engine'

interface OpenedDb {
  paths: AppPaths
  database: WrappedDatabase
  schemaBlocked: { found: number; supported: number } | null
  recoveryPath: string | null
}

export class AppRuntime {
  private real: OpenedDb
  private demo: OpenedDb | null = null
  private view: 'demo' | 'real'
  private connection: LcuConnection | null = null
  private discovery: { state: DiscoveryView['state']; port: number | null; installDir: string | null; password: string | null } = {
    state: 'missing',
    port: null,
    installDir: null,
    password: null
  }
  private active: { runId: string; accountId: string; abort: AbortController; promise: Promise<SyncRunResult> } | null = null
  private lastManualAt: number | null = null
  private listeners = new Set<(progress: SyncView) => void>()
  private playerRefresh: Promise<void> | null = null
  private playerAbort = new AbortController()
  readonly logger: Logger

  private constructor(
    private readonly processMode: 'demo' | 'real',
    real: OpenedDb
  ) {
    this.real = real
    this.view = processMode
    this.logger = new Logger(real.paths.logsDir)
    this.discovery = { state: processMode === 'demo' ? 'skipped' : 'missing', port: null, installDir: null, password: null }
  }

  static async open(env: NodeJS.ProcessEnv = process.env): Promise<AppRuntime> {
    const roots = resolveRoots(env)
    const paths = layoutFromRoot(roots.root, roots.mode, roots.offline)
    const opened = await openWrappedDatabase(paths.dbFile)
    if (!opened.database) throw new Error('database-unavailable')
    const runtime = new AppRuntime(roots.mode, {
      paths,
      database: opened.database,
      schemaBlocked: opened.schemaBlocked,
      recoveryPath: opened.recoveryPath
    })
    if (roots.mode === 'demo' && !opened.schemaBlocked) {
      seedDemo(opened.database, Date.now(), env.ARAM_WRAPPED_DEMO_ALIAS || undefined)
    }
    runtime.refreshDiscovery()
    runtime.logger.info('app.open', { mode: roots.mode, offline: runtime.offline, schemaBlocked: Boolean(opened.schemaBlocked) })
    return runtime
  }

  get offline(): boolean {
    return this.view === 'demo' || this.current.paths.offline || this.setting('offline') === '1'
  }

  get current(): OpenedDb {
    return this.view === 'demo' && this.demo ? this.demo : this.real
  }

  onProgress(listener: (progress: SyncView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  bootstrap(): Bootstrap {
    const db = this.current.database
    const locale = this.setting('locale') === 'en' ? 'en' : 'zh-CN'
    const timeZone = this.setting('timeZone') || systemTimeZone()
    const activeAccountId = this.setting('activeAccountId')
    const account = activeAccountId ? db.getAccount(activeAccountId) : null
    const summary = account ? db.storageSummary(account.accountId) : { stored: 0, mayhemComplete: 0, earliest: null, unverified: 0 }
    return {
      mode: this.view,
      offline: this.offline,
      realClientVerified: REAL_CLIENT_IMPORT_VERIFIED,
      locale,
      timeZone,
      imageDownloads: this.setting('imageDownloads') === 'never' ? 'never' : 'auto',
      leagueDir: this.setting('leagueDir'),
      storagePath: this.current.paths.dataDir,
      logPath: this.current.paths.logsDir,
      activeAccountId: account?.accountId ?? null,
      accounts: db.listPublicAccounts(),
      discovery: this.publicDiscovery(),
      schemaBlocked: this.current.schemaBlocked,
      recoveryPath: this.current.recoveryPath,
      hasCachedMatches: summary.stored > 0
    }
  }

  refreshDiscovery(): DiscoveryView {
    if (this.view === 'demo' || this.offline) {
      this.connection = null
      this.discovery = { state: 'skipped', port: null, installDir: null, password: null }
      return this.publicDiscovery()
    }
    const found = discoverInstall({
      preferredDir: this.setting('leagueDir'),
      readFile: readLockfile,
      pidAlive: windowsPidIsLeague
    })
    this.discovery = found
    this.connection = found.state === 'found' && found.password && found.port
      ? { port: found.port, authorization: `Basic ${Buffer.from(`riot:${found.password}`).toString('base64')}` }
      : null
    this.logger.info('lcu.discovery', { state: found.state, port: found.port })
    return this.publicDiscovery()
  }

  async useDemo(): Promise<Bootstrap> {
    if (this.view === 'demo' && this.processMode === 'demo') return this.bootstrap()
    if (!this.demo) {
      const root = this.processMode === 'demo' ? this.real.paths.root : path.join(this.real.paths.root, 'demo')
      const paths = layoutFromRoot(root, 'demo', true)
      const opened = await openWrappedDatabase(paths.dbFile)
      if (!opened.database) throw new Error('database-unavailable')
      this.demo = { paths, database: opened.database, schemaBlocked: opened.schemaBlocked, recoveryPath: opened.recoveryPath }
      if (!opened.schemaBlocked) seedDemo(opened.database, Date.now(), process.env.ARAM_WRAPPED_DEMO_ALIAS || undefined)
    } else if (!this.demo.schemaBlocked) {
      seedDemo(this.demo.database, Date.now(), process.env.ARAM_WRAPPED_DEMO_ALIAS || undefined)
    }
    this.view = 'demo'
    this.connection = null
    return this.bootstrap()
  }

  useReal(): Bootstrap {
    if (this.processMode === 'demo') return this.bootstrap()
    this.view = 'real'
    this.refreshDiscovery()
    return this.bootstrap()
  }

  updateSettings(input: SettingsInput): Bootstrap {
    const db = this.current.database
    db.setSetting('locale', input.locale)
    db.setSetting('timeZone', input.timeZone)
    db.setSetting('offline', input.offline ? '1' : '0')
    db.setSetting('imageDownloads', input.imageDownloads)
    db.setSetting('leagueDir', input.leagueDir?.trim() || '')
    if (input.offline) void this.cancelActive()
    if (this.view === 'real') this.refreshDiscovery()
    return this.bootstrap()
  }

  setLeagueDir(dir: string): void {
    this.current.database.setSetting('leagueDir', dir)
    if (this.view === 'real') this.refreshDiscovery()
  }

  deleteAccount(accountId: string): Bootstrap {
    const db = this.current.database
    db.deleteAccount(accountId)
    if (this.setting('activeAccountId') === accountId) db.setSetting('activeAccountId', '')
    this.logger.info('account.delete', { accountId })
    return this.bootstrap()
  }

  dashboard(input: RangeInput) {
    this.assertReady()
    return queryDashboard(this.current.database, input, { mode: this.view, clientUnavailable: this.clientUnavailable() })
  }

  matches(input: RangeInput & { cursor: string | null }) {
    this.assertReady()
    return queryMatches(this.current.database, input)
  }

  detail(input: { accountId: string; platformId: string; gameId: string; locale: 'zh-CN' | 'en'; timeZone: string }) {
    this.assertReady()
    return queryDetail(this.current.database, input)
  }

  exportSnapshot(input: ExportInput): ExportSnapshot {
    this.assertReady()
    return queryExport(this.current.database, input, { mode: this.view, clientUnavailable: this.clientUnavailable() })
  }

  async connectAndSync(): Promise<Bootstrap> {
    this.refreshDiscovery()
    if (this.discovery.state !== 'found' || !this.connection) return this.bootstrap()
    const transport = createLiveTransport(() => this.connection, () => this.offline)
    const identity = await transport.currentSummoner()
    const account = this.current.database.upsertAccount({ ...identity, now: Date.now() })
    this.current.database.setSetting('activeAccountId', account.accountId)
    await this.startSync(account.accountId, 'launch')
    return this.bootstrap()
  }

  refreshPlayerIds(): Promise<void> {
    if (this.playerRefresh) return this.playerRefresh
    this.playerRefresh = this.runPlayerRefresh().finally(() => { this.playerRefresh = null })
    return this.playerRefresh
  }

  async startSync(accountId: string, kind: 'launch' | 'manual' | 'continue' | 'rebuild'): Promise<{ runId: string }> {
    void this.refreshPlayerIds()
    this.assertReady()
    if (this.view === 'demo' || this.offline) {
      throw Object.assign(new Error('offline'), { code: 'offline' })
    }
    if (this.active && this.active.accountId !== accountId) await this.cancelActive()
    const decision = decideStart({
      activeRunId: this.active?.accountId === accountId ? this.active.runId : null,
      lastManualAt: this.lastManualAt,
      now: Date.now(),
      kind
    })
    if (decision.action === 'join') return { runId: decision.runId }
    if (decision.action === 'reject') throw Object.assign(new Error('throttled'), { code: 'throttled' })
    this.refreshDiscovery()
    if (!this.connection) throw Object.assign(new Error('client-unavailable'), { code: 'client_unavailable' })
    const account = this.current.database.getAccount(accountId)
    if (!account) throw Object.assign(new Error('missing-account'), { code: 'missing_account' })
    void refreshAccountProfile(this.current.database, accountId, this.connection, this.setting('leagueDir') || 'C:/Riot Games/League of Legends', () => this.offline).then(() => { const event = { runId: 'profile', state: 'complete', discovered: 0, committed: 0, skipped: 0, failed: 0, accountId }; for (const listener of this.listeners) listener(event) }).catch(() => undefined)
    const state = this.current.database.readSyncState(accountId)
    const mode = kind === 'rebuild' || kind === 'continue' || state?.adapterVersion !== CANDIDATE_ADAPTER_VERSION ? 'backfill' : kind === 'manual' ? launchMode(state ? { needsBackfill: state.continuation.needsBackfill, lastExhaustiveAt: state.continuation.lastExhaustiveAt } : null) : launchMode(state ? { needsBackfill: state.continuation.needsBackfill, lastExhaustiveAt: state.continuation.lastExhaustiveAt } : null)
    if (kind === 'manual') this.lastManualAt = Date.now()
    const abort = new AbortController()
    const transport = createLiveTransport(() => this.connection, () => this.offline)
    let runId = ''
    const promise = runSync({
      mode: kind === 'rebuild' ? 'rebuild' : mode === 'incremental' ? 'incremental' : 'backfill',
      adapter: {
        version: CANDIDATE_ADAPTER_VERSION,
        indexMode: 'endInclusive',
        pageSize: 200,
        adaptList: adaptCandidateList,
        adaptDetail: (payload, puuid) => adaptCandidateDetail(payload, puuid)
      },
      transport,
      repo: this.current.database,
      account,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      signal: abort.signal,
      budget: { maxCharged: 10000, maxMs: 4 * 60 * 60 * 1000 },
      offline: this.offline,
      rediscover: async () => {
        this.refreshDiscovery()
        if (!this.connection) throw Object.assign(new Error('client-unavailable'), { code: 'client_unavailable' })
      },
      onProgress: (progress) => {
        runId = progress.runId
        const view = { runId: progress.runId, state: progress.state, discovered: progress.discovered, committed: progress.committed, skipped: progress.skipped, failed: progress.failed, accountId: progress.accountId }
        for (const listener of this.listeners) listener(view)
      }
    }).then((value) => {
      if (this.active?.promise === promise) this.active = null
      this.logger.info('sync.finish', { runId: value.runId, termination: value.termination, discovered: value.discovered, committed: value.committed, skipped: value.skipped, failed: value.failed })
      return value
    })
    void promise.catch((error: unknown) => {
      if (this.active?.promise === promise) this.active = null
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'sync-failed'
      this.logger.info('sync.error', { code })
    })
    this.active = { runId, accountId, abort, promise }
    return { runId }
  }

  async cancel(runId: string): Promise<void> {
    if (this.active && this.active.runId === runId) {
      this.active.abort.abort()
      await this.active.promise.catch(() => undefined)
      this.active = null
    }
  }

  async shutdown(): Promise<void> {
    this.playerAbort.abort()
    await this.playerRefresh?.catch(() => undefined)
    await this.cancelActive()
    this.connection = null
    this.real.database.close()
    this.demo?.database.close()
  }

  icons(input: IconQuery): Promise<IconCatalog> {
    return resolveGameIcons({
      directory: this.current.paths.assetsDir,
      query: input,
      downloads: !this.offline && this.setting('imageDownloads') !== 'never'
    })
  }

  openLeague(): { ok: boolean; message: string } {
    const dir = this.setting('leagueDir') || 'C:\\Riot Games\\League of Legends'
    const executable = path.join(dir, 'LeagueClient.exe')
    if (!fs.existsSync(executable)) return { ok: false, message: 'league-missing' }
    return { ok: true, message: executable }
  }

  private async runPlayerRefresh(): Promise<void> {
    if (this.view === 'demo' || this.offline || this.playerAbort.signal.aborted) return
    this.refreshDiscovery()
    if (!this.connection) return
    const accountId = this.setting('activeAccountId')
    const account = accountId ? this.current.database.getAccount(accountId) : null
    if (!account) return
    const missing = this.current.database.gamesMissingPlayerIds(account.accountId)
    if (missing.length === 0) return
    const transport = createLiveTransport(() => this.connection, () => this.offline)
    let committed = 0
    for (const game of missing) {
      if (this.playerAbort.signal.aborted) return
      try {
        const payload = await transport.getGame(game.gameId)
        const normalized = adaptCandidateDetail(payload, account.puuid)
        if (normalized.platformId !== game.platformId || normalized.gameId !== game.gameId) continue
        this.current.database.commitMatch(account.accountId, normalized, Date.now())
        committed += 1
        if (committed % 25 === 0) this.publishPlayerProgress(account.accountId, missing.length, committed)
      } catch {
        continue
      }
    }
    this.publishPlayerProgress(account.accountId, missing.length, committed, true)
    this.logger.info('players.refresh', { missing: missing.length, committed })
  }

  private publishPlayerProgress(accountId: string, discovered: number, committed: number, complete = false): void {
    const view = { runId: 'players', state: complete ? 'complete' : 'committing', discovered, committed, skipped: 0, failed: 0, accountId }
    for (const listener of this.listeners) listener(view)
  }

  private async cancelActive(): Promise<void> {
    if (!this.active) return
    this.active.abort.abort()
    await this.active.promise.catch(() => undefined)
    this.active = null
  }

  private assertReady(): void {
    if (this.current.schemaBlocked) throw Object.assign(new Error('schema-too-new'), { code: 'schema_too_new' })
  }

  private clientUnavailable(): boolean {
    return this.view === 'real' && !this.offline && this.discovery.state !== 'found' && this.discovery.state !== 'pending'
  }

  private setting(key: string): string | null {
    const value = this.current.database.getSetting(key)
    return value && value.length > 0 ? value : null
  }

  private publicDiscovery(): DiscoveryView {
    return { state: this.discovery.state, port: null }
  }
}
