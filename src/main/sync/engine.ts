import type { ListedMatch, NormalizedMatch } from '@shared/types'
import type { WrappedDatabase, ContinuationState } from '../db/repository'
import { matchKey, splitMatchKey } from '../identity'
import { AdapterError, SyncHalt, TransportError } from '../lcu/errors'
import { acceptHistoryPage, HISTORY_CACHE_RETRIES, HISTORY_CACHE_RETRY_MS, pageBounds, readHistoryWindow, type IndexMode } from '../lcu/paging'

export interface SyncAccount {
  accountId: string
  platformId: string
  puuid: string
}

export interface SyncTransport {
  currentSummoner(): Promise<{ platformId: string; puuid: string; alias: string }>
  listMatches(puuid: string, begIndex: number, endIndex: number): Promise<unknown>
  getGame(gameId: string): Promise<unknown>
}

export interface SyncAdapter {
  version: string
  indexMode: IndexMode
  pageSize: number
  adaptList(payload: unknown): ListedMatch[]
  adaptDetail(payload: unknown, selfPuuid: string): NormalizedMatch
}

export interface SyncProgress {
  runId: string
  state: string
  discovered: number
  committed: number
  skipped: number
  failed: number
  unavailable: number
  accountId: string
}

export interface SyncRunResult {
  runId: string
  termination: string
  diagnostic: string | null
  discovered: number
  committed: number
  skipped: number
  failed: number
  unavailable: number
  lastSuccessfulScan: number | null
}

export interface RunSyncOptions {
  mode: 'incremental' | 'rebuild' | 'backfill'
  adapter: SyncAdapter
  transport: SyncTransport
  repo: WrappedDatabase
  account: SyncAccount
  now: () => number
  sleep: (ms: number) => Promise<void>
  random?: () => number
  signal?: AbortSignal
  budget?: { maxCharged: number; maxMs: number }
  paceMs?: number
  overlapCount?: number
  offline?: boolean
  rediscover?: () => Promise<void>
  onProgress?: (progress: SyncProgress) => void
}

const EMPTY_CONTINUATION: ContinuationState = {
  needsBackfill: true,
  partial: false,
  reason: null,
  gaps: [],
  pendingIds: [],
  lastExhaustiveAt: null,
  earliestAccessibleUtc: null
}

function permanent(error: TransportError): boolean {
  return (
    error.status === 404 ||
    error.status === 403 ||
    error.code === 'malformed_json' ||
    error.code === 'client_exited' ||
    error.code === 'redirect' ||
    error.code === 'non_loopback' ||
    error.code === 'offline'
  )
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const loops = Math.min(limit, items.length)
  async function loop(): Promise<void> {
    while (index < items.length) {
      const current = items[index]
      index += 1
      if (current === undefined) return
      await worker(current)
    }
  }
  await Promise.all(Array.from({ length: loops }, () => loop()))
}

export function launchMode(state: { needsBackfill: boolean; lastExhaustiveAt: number | null } | null): 'backfill' | 'incremental' {
  if (!state || state.needsBackfill || state.lastExhaustiveAt == null) return 'backfill'
  return 'incremental'
}

export function requestedSyncMode(kind: 'launch' | 'manual' | 'continue' | 'rebuild', state: {adapterVersion: string | null; continuation: {needsBackfill: boolean; lastExhaustiveAt: number | null}} | null, adapterVersion: string): RunSyncOptions['mode'] {
  if (kind === 'rebuild') return 'rebuild'
  if (kind === 'continue') return 'backfill'
  if (state && state.adapterVersion !== adapterVersion) return 'rebuild'
  if (kind === 'manual') return 'incremental'
  return launchMode(state ? state.continuation : null)
}

export function decideStart(input: {
  activeRunId: string | null
  lastManualAt: number | null
  now: number
  kind: 'launch' | 'manual' | 'continue' | 'rebuild'
}): { action: 'join'; runId: string } | { action: 'reject'; code: 'throttled' } | { action: 'start' } {
  if (input.activeRunId) return { action: 'join', runId: input.activeRunId }
  if (input.kind === 'manual' && input.lastManualAt != null && input.now - input.lastManualAt < 30000) {
    return { action: 'reject', code: 'throttled' }
  }
  return { action: 'start' }
}

export async function runSync(options: RunSyncOptions): Promise<SyncRunResult> {
  const budget = options.budget ?? { maxCharged: 500, maxMs: 120_000 }
  const paceMs = options.paceMs ?? 100
  const overlapCount = options.overlapCount ?? 40
  const startedAt = options.now()
  const { repo, account, adapter, transport } = options
  const runId = repo.createRun(account.accountId, startedAt)
  let discovered = 0
  let committed = 0
  let skipped = 0
  let failed = 0
  let unavailable = 0
  let charged = 0
  let termination = 'partial_failure'
  let diagnostic: string | null = null
  let earliestSeen: number | null = null
  let latestSeen: number | null = null
  let nextOffset = 0
  const pending: string[] = []
  let rediscovered = false
  let stop = false
  let nextSlot = options.now()
  let paceChain: Promise<void> = Promise.resolve()

  const publish = (state: string) => {
    repo.updateRun(runId, { state, discovered, committed, skipped, failed })
    try {
      options.onProgress?.({ runId, state, discovered, committed, skipped, failed, unavailable, accountId: account.accountId })
    } catch {
      // A closed or reloading window must not abort a history walk.
    }
  }

  const finish = (reason: string) => {
    const previous = repo.readSyncState(account.accountId)
    const prior = previous?.continuation ?? EMPTY_CONTINUATION
    let lastSuccessful = previous?.lastSuccessfulScan ?? null
    let continuation: ContinuationState
    if (reason === 'empty_page' && failed === 0) {
      lastSuccessful = options.now()
      continuation = {
        needsBackfill: false,
        partial: false,
        reason,
        gaps: [],
        pendingIds: [],
        lastExhaustiveAt: options.now(),
        earliestAccessibleUtc: earliestSeen ?? prior.earliestAccessibleUtc,
        historyOffset: 0
      }
    } else if (reason === 'overlap_stable' && failed === 0 && options.mode === 'incremental') {
      lastSuccessful = options.now()
      continuation = {
        ...prior,
        needsBackfill: prior.needsBackfill && prior.lastExhaustiveAt == null,
        partial: prior.needsBackfill && prior.lastExhaustiveAt == null,
        reason,
        pendingIds: [],
        historyOffset: prior.needsBackfill ? prior.historyOffset ?? 0 : 0
      }
    } else {
      const oldest = earliestSeen
      continuation = {
        needsBackfill: true,
        partial: true,
        reason,
        gaps: oldest == null ? prior.gaps : [{ startUtc: 0, endUtc: oldest }],
        pendingIds: pending,
        lastExhaustiveAt: prior.lastExhaustiveAt,
        earliestAccessibleUtc: prior.earliestAccessibleUtc,
        historyOffset: options.mode === 'incremental' && prior.needsBackfill ? prior.historyOffset ?? 0 : nextOffset
      }
    }
    repo.writeSyncState(account.accountId, {
      lastSuccessfulScan: lastSuccessful,
      latestSeenStart: latestSeen ?? previous?.latestSeenStart ?? null,
      adapterVersion: adapter.version,
      continuation
    })
    repo.finishRun(runId, {
      state: reason,
      termination: reason,
      diagnostic,
      earliestAccessibleUtc: continuation.earliestAccessibleUtc,
      now: options.now(),
      discovered,
      committed,
      skipped,
      failed
    })
    publish(reason)
    return {
      runId,
      termination: reason,
      diagnostic,
      discovered,
      committed,
      skipped,
      failed,
      unavailable,
      lastSuccessfulScan: lastSuccessful
    }
  }

  if (options.offline) return finish('offline')

  const pace = () => {
    const run = paceChain.then(async () => {
      if (paceMs <= 0) return
      const current = options.now()
      const wait = Math.max(0, nextSlot - current)
      nextSlot = Math.max(nextSlot, current) + paceMs
      if (wait > 0) await options.sleep(wait)
    })
    paceChain = run.then(() => undefined, () => undefined)
    return run
  }

  const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let attempt = 0
    while (true) {
      if (options.signal?.aborted || stop) throw new SyncHalt('cancelled')
      try {
        return await fn()
      } catch (error) {
        if (error instanceof SyncHalt) throw error
        if (!(error instanceof TransportError)) throw error
        if (error.code === 'client_exited') {
          stop = true
          throw new SyncHalt('cancelled')
        }
        if (error.status === 401) {
          if (rediscovered || !options.rediscover) throw error
          rediscovered = true
          await options.rediscover()
          continue
        }
        if (error.status === 429) {
          const wait = error.retryAfterMs ?? 1000
          if (options.now() + wait - startedAt > budget.maxMs) throw error
          await options.sleep(wait)
          continue
        }
        if (error.status === 403) throw new SyncHalt('capability_forbidden')
        if (permanent(error)) throw error
        attempt += 1
        if (attempt >= 3) throw error
        const base = attempt === 1 ? 1000 : 2000
        const jitter = Math.floor((options.random?.() ?? 0) * 200)
        await options.sleep(base + jitter)
      }
    }
  }

  const assertIdentity = async () => {
    const identity = await transport.currentSummoner()
    if (identity.puuid !== account.puuid || identity.platformId !== account.platformId) {
      throw new SyncHalt('account_changed')
    }
  }

  try {
    publish('identifying')
    await assertIdentity()
    const complete = repo.completeKeys(account.accountId)
    const settled = new Set([...complete, ...repo.quarantinedKeys(account.accountId)])
    const incomplete = repo.incompleteKeys(account.accountId)
    const due = repo.dueRetryKeys(account.accountId, options.now())
    const overlap = new Set(options.mode === 'incremental' ? repo.newestKnownIds(account.accountId, overlapCount) : [])
    const revalidated = new Set<string>()
    const seen = new Set<string>()
    const savedOffset = repo.readSyncState(account.accountId)?.continuation.historyOffset ?? 0
    let offset = options.mode === 'backfill' && savedOffset > 0 ? Math.max(0, savedOffset - adapter.pageSize) : 0
    nextOffset = offset
    let previousSignature: string | null = null
    let consecutiveQuiet = 0
    let staleReads = 0
    const fullScan = options.mode !== 'incremental'

    const ingestListed = async (items: ListedMatch[], countQuiet: boolean): Promise<'ok' | 'stop'> => {
      const unique: ListedMatch[] = []
      const inPage = new Set<string>()
      for (const item of items) {
        const platformId = item.platformId || account.platformId
        const key = matchKey(platformId, item.gameId)
        if (inPage.has(key)) continue
        inPage.add(key)
        unique.push({ ...item, platformId })
        if (!seen.has(key)) {
          seen.add(key)
          discovered += 1
        }
        if (item.startUtc != null) {
          earliestSeen = earliestSeen == null ? item.startUtc : Math.min(earliestSeen, item.startUtc)
          latestSeen = latestSeen == null ? item.startUtc : Math.max(latestSeen, item.startUtc)
        }
      }
      const needs = unique.filter((item) => {
        const key = matchKey(item.platformId, item.gameId)
        const overlapHit = overlap.has(key) && !revalidated.has(key)
        if (options.mode === 'rebuild') return true
        return !settled.has(key) || incomplete.has(key) || due.has(key) || overlapHit
      })
      if (countQuiet) consecutiveQuiet = needs.length === 0 ? consecutiveQuiet + 1 : 0
      const room = budget.maxCharged - charged
      const batch = needs.slice(0, Math.max(0, room))
      for (const item of needs.slice(batch.length)) pending.push(matchKey(item.platformId, item.gameId))
      charged += batch.length
      if (batch.length === 0) return 'ok'
      publish('fetching')
      try {
        await mapPool(batch, 2, async (item) => {
          if (options.signal?.aborted || stop) return
          const key = matchKey(item.platformId, item.gameId)
          try {
            await pace()
            const raw = await withRetry(() => transport.getGame(item.gameId))
            await assertIdentity()
            let normalized: NormalizedMatch
            try {
              normalized = adapter.adaptDetail(raw, account.puuid)
            } catch (error) {
              if (error instanceof AdapterError) {
                failed += 1
                repo.recordFailure(account.accountId, item.platformId, item.gameId, error.code, options.now() + 30_000, options.now())
                return
              }
              throw error
            }
            normalized.platformId = normalized.platformId || item.platformId
            normalized.gameId = normalized.gameId || item.gameId
            if (normalized.startUtc == null && item.startUtc != null) normalized.startUtc = item.startUtc
            await assertIdentity()
            publish('committing')
            const outcome = repo.commitMatch(account.accountId, normalized, options.now())
            if (outcome === 'skipped') skipped += 1
            else committed += 1
            repo.clearFailure(account.accountId, item.platformId, item.gameId)
            settled.add(key)
            complete.add(key)
            if (overlap.has(key)) revalidated.add(key)
            incomplete.delete(key)
            due.delete(key)
          } catch (error) {
            if (error instanceof SyncHalt) throw error
            if (error instanceof TransportError && error.status === 404) {
              unavailable += 1
              repo.recordFailure(account.accountId, item.platformId, item.gameId, 'not_found', null, options.now())
              if (overlap.has(key)) revalidated.add(key)
              return
            }
            if (error instanceof TransportError && error.status === 429) {
              failed += 1
              repo.recordFailure(account.accountId, item.platformId, item.gameId, 'rate_limited', options.now() + (error.retryAfterMs ?? 1000), options.now())
              return
            }
            failed += 1
            const code = error instanceof TransportError ? error.code : 'detail-failed'
            const retryAt = options.now() + 30_000
            const parts = splitMatchKey(key)
            if (parts) repo.recordFailure(account.accountId, parts.platformId, parts.gameId, code, retryAt, options.now())
          }
        })
      } catch (error) {
        if (error instanceof SyncHalt) {
          termination = error.reason === 'budget_time' ? 'budget_time' : error.reason === 'capability_forbidden' ? 'capability_forbidden' : error.reason === 'account_changed' ? 'account_changed' : 'cancelled'
          diagnostic = error.reason
          return 'stop'
        }
        termination = 'partial_failure'
        diagnostic = 'detail-failed'
        return 'stop'
      }
      return 'ok'
    }

    publish('listing')
    while (true) {
      if (options.signal?.aborted || stop) {
        termination = 'cancelled'
        diagnostic = stop ? 'client_exited' : 'cancelled'
        break
      }
      if (charged >= budget.maxCharged) {
        termination = 'budget_entries'
        break
      }
      if (options.now() - startedAt >= budget.maxMs) {
        termination = 'budget_time'
        break
      }
      try {
        await assertIdentity()
      } catch (error) {
        if (error instanceof SyncHalt) {
          termination = error.reason === 'cancelled' ? 'cancelled' : error.reason
          diagnostic = error.reason
          break
        }
        if (!(error instanceof TransportError) && !(error instanceof AdapterError)) throw error
        staleReads += 1
        if (staleReads > HISTORY_CACHE_RETRIES) {
          termination = 'partial_failure'
          diagnostic = error.code
          break
        }
        await options.sleep(HISTORY_CACHE_RETRY_MS)
        continue
      }
      const bounds = pageBounds(offset, adapter.pageSize, adapter.indexMode)
      let page: ListedMatch[]
      let payload: unknown
      let elapsedMs = 0
      try {
        const listedAt = Date.now()
        payload = await withRetry(() => transport.listMatches(account.puuid, bounds.begIndex, bounds.endIndex))
        elapsedMs = Date.now() - listedAt
        page = adapter.adaptList(payload)
      } catch (error) {
        if (error instanceof SyncHalt) {
          termination = error.reason === 'cancelled' ? 'cancelled' : error.reason
          diagnostic = error.reason
          break
        }
        if (error instanceof AdapterError) {
          termination = 'capability_forbidden'
          diagnostic = error.code
          break
        }
        if (error instanceof TransportError && error.status === 429) {
          termination = 'partial_failure'
          diagnostic = 'rate_limited'
          break
        }
        termination = 'partial_failure'
        diagnostic = error instanceof TransportError ? error.code : 'list-failed'
        break
      }
      if (!acceptHistoryPage({ payload, begIndex: bounds.begIndex, endIndex: bounds.endIndex, elapsedMs })) {
        const cachedBegin = readHistoryWindow(payload).indexBegin
        if (cachedBegin != null && cachedBegin !== bounds.begIndex && page.length > 0) {
          if (await ingestListed(page, false) === 'stop') break
        }
        staleReads += 1
        if (staleReads > HISTORY_CACHE_RETRIES) {
          termination = 'partial_failure'
          diagnostic = 'history_cache'
          break
        }
        await options.sleep(HISTORY_CACHE_RETRY_MS)
        continue
      }
      staleReads = 0
      if (page.length === 0) {
        termination = 'empty_page'
        break
      }
      const signature = page.map((item) => matchKey(item.platformId || account.platformId, item.gameId)).join('|')
      if (signature === previousSignature) {
        termination = 'repeated_page'
        break
      }
      previousSignature = signature
      if (await ingestListed(page, true) === 'stop') break
      if (options.signal?.aborted || stop) {
        termination = 'cancelled'
        diagnostic = stop ? 'client_exited' : 'cancelled'
        break
      }
      const overlapCovered = [...overlap].every((key) => revalidated.has(key))
      if (!fullScan && overlapCovered && consecutiveQuiet >= 2) {
        termination = 'overlap_stable'
        break
      }
      nextOffset = offset + adapter.pageSize
      if (charged >= budget.maxCharged) {
        termination = 'budget_entries'
        break
      }
      offset = nextOffset
    }
  } catch (error) {
    if (error instanceof SyncHalt) {
      termination = error.reason === 'account_changed' ? 'account_changed' : error.reason === 'capability_forbidden' ? 'capability_forbidden' : 'cancelled'
      diagnostic = error.reason
    } else {
      termination = 'partial_failure'
      diagnostic = 'sync-failed'
    }
  }
  return finish(termination)
}

export function listGameCount(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const nested = record.games && typeof record.games === 'object' && !Array.isArray(record.games) ? record.games as Record<string, unknown> : null
  const value = nested?.gameCount ?? record.gameCount
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
