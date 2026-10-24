import { describe, expect, it } from 'vitest'
import { requestedSyncMode, runSync } from '../src/main/sync/engine'
import { syncError, syncFinished } from '../src/shared/sync-status'
import { mayhemMatch, tempDatabase } from './helpers'

describe('settings sync actions', () => {
  it.each([
    ['manual', 0, 40],
    ['continue', 60, 0],
    ['rebuild', 0, 100]
  ] as const)('%s reads the correct history window and preserves stored games', async (kind, firstOffset, fetchedCount) => {
    const temp = await tempDatabase()
    try {
      const account = temp.db.upsertAccount({platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester', now: 1})
      const games = Array.from({length: 100}, (_, i) => ({id: 'known-' + i, start: 10000 - i}))
      for (const game of games) temp.db.commitMatch(account.accountId, mayhemMatch(game.id, game.start), 1)
      temp.db.writeSyncState(account.accountId, {
        lastSuccessfulScan: null, latestSeenStart: 10000, adapterVersion: 'test',
        continuation: {needsBackfill: true, partial: true, reason: 'budget_entries', gaps: [], pendingIds: [],
          lastExhaustiveAt: null, earliestAccessibleUtc: null, historyOffset: 80}
      })
      const listed: number[] = []
      const fetched: string[] = []
      const state = temp.db.readSyncState(account.accountId)
      const result = await runSync({
        mode: requestedSyncMode(kind, state, 'test'),
        adapter: {
          version: 'test', indexMode: 'endExclusive', pageSize: 20,
          adaptList: payload => (payload as typeof games).map(game => ({platformId: 'NA1', gameId: game.id, queueId: 9000, startUtc: game.start})),
          adaptDetail: payload => { const game = payload as typeof games[number]; return mayhemMatch(game.id, game.start) }
        },
        transport: {
          currentSummoner: async () => ({platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester'}),
          listMatches: async (_puuid, beg, end) => { listed.push(beg); return games.slice(beg, end) },
          getGame: async id => { fetched.push(id); return games.find(game => game.id === id)! }
        },
        repo: temp.db, account: {accountId: account.accountId, platformId: 'NA1', puuid: 'self-puuid'}, now: () => 50000, sleep: async () => undefined, paceMs: 0
      })
      expect(listed[0]).toBe(firstOffset)
      expect(fetched).toHaveLength(fetchedCount)
      expect(temp.db.count('matches')).toBe(100)
      if (kind === 'manual') {
        expect(result.termination).toBe('overlap_stable')
        expect(temp.db.readSyncState(account.accountId)?.continuation.historyOffset).toBe(80)
        expect(temp.db.readSyncState(account.accountId)?.continuation.needsBackfill).toBe(true)
      }
    } finally { temp.close() }
  })

  it('revalidates from the newest page when the adapter has changed', () => {
    expect(requestedSyncMode('manual', {adapterVersion: 'old', continuation: {needsBackfill: true, lastExhaustiveAt: null}}, 'new')).toBe('rebuild')
  })
  it('keeps actionable failures distinct from successful completion', () => {
    expect(syncError('throttled', 'zh-CN')).toContain('30')
    expect(syncError('client_unavailable', 'en')).toContain('Sign in')
    expect(syncError('offline', 'zh-CN')).toContain('关闭离线')
    expect(syncFinished('committing')).toBe(false)
    expect(syncFinished('partial_failure')).toBe(true)
    expect(syncFinished('cancelled')).toBe(true)
  })
})
