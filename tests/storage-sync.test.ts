import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWrappedDatabase } from '../src/main/db/open'
import { Logger } from '../src/main/logger'
import { discoverInstall } from '../src/main/lcu/discover'
import { planLoopbackGet } from '../src/main/lcu/transport'
import { TransportError } from '../src/main/lcu/errors'
import { listGameCount, runSync } from '../src/main/sync/engine'
import { seedDemo } from '../src/main/demo/seed'
import { queryDashboard } from '../src/main/services/query'
import { runExport } from '../src/main/export/write'
import { mayhemMatch, tempDatabase } from './helpers'
import type { WrappedDatabase } from '../src/main/db/repository'
import type { ListedMatch, NormalizedMatch } from '../src/shared/types'

const closers: Array<() => void> = []
afterEach(() => {
  while (closers.length) closers.pop()?.()
})

async function openTemp(): Promise<WrappedDatabase> {
  const opened = await tempDatabase()
  closers.push(opened.close)
  return opened.db
}

function account(db: WrappedDatabase, puuid = 'self-puuid', alias = 'Tester') {
  return db.upsertAccount({ platformId: 'NA1', puuid, alias, now: 1 })
}

describe('storage', () => {
  it('imports the same match twice without accumulating children', async () => {
    const db = await openTemp()
    const saved = account(db)
    const first = mayhemMatch('g1', 1_000, { items: [3031, 3031], augments: ['aug-prism', 'aug-prism'] })
    expect(db.commitMatch(saved.accountId, first, 1)).toBe('inserted')
    expect(db.commitMatch(saved.accountId, first, 2)).toBe('skipped')
    expect(db.count('matches')).toBe(1)
    expect(db.count('participant_items')).toBe(2)
    const changed = mayhemMatch('g1', 1_000, { marker: 'changed', items: [1001], augments: ['aug-blade'] })
    expect(db.commitMatch(saved.accountId, changed, 3)).toBe('replaced')
    expect(db.count('participant_items')).toBe(1)
    expect(db.count('participant_augments')).toBe(1)
  })

  it('rolls back a match when the write stops between parent and child', async () => {
    const db = await openTemp()
    const saved = account(db)
    db.commitMatch(saved.accountId, mayhemMatch('old', 1), 1)
    db.crashAfterParentInsert = true
    expect(() => db.commitMatch(saved.accountId, mayhemMatch('new', 2), 2)).toThrow(/crash-between-parent-and-child/)
    expect(db.count('matches')).toBe(1)
    expect(db.rawPayload('NA1', 'new')).toBeNull()
  })

  it('keeps a shared game when one account is deleted and preserves each self row', async () => {
    const db = await openTemp()
    const first = account(db, 'puuid-a', 'A')
    const second = account(db, 'puuid-b', 'B')
    db.commitMatch(first.accountId, mayhemMatch('shared', 10, { participantId: '1', kills: 9 }), 1)
    db.commitMatch(second.accountId, mayhemMatch('shared', 10, { participantId: '2', kills: 3, marker: 'b' }), 2)
    db.commitMatch(first.accountId, mayhemMatch('only-a', 11), 3)
    const shared = db.listParticipants('NA1', 'shared')
    expect(shared.map((row) => String(row.participant_id)).sort()).toEqual(['1', '2'])
    db.deleteAccount(first.accountId)
    expect(db.getAccount(first.accountId)).toBeNull()
    expect(db.count('matches')).toBe(1)
    expect(db.getOwnedMatch(second.accountId, 'NA1', 'shared')).not.toBeNull()
  })

  it('rejects a newer schema and recovers a corrupt file without discarding the copy', async () => {
    const opened = await tempDatabase()
    const file = path.join(opened.root, 'data', 'wrapped.sqlite')
    opened.db.close()
    const raw = new (await import('better-sqlite3')).default(file)
    raw.prepare('INSERT INTO schema_version(version, applied_at, description) VALUES (99, 1, ?)').run('future')
    raw.close()
    const blocked = await openWrappedDatabase(file)
    expect(blocked.schemaBlocked?.found).toBe(99)
    blocked.database?.close()
    fs.writeFileSync(file, 'not a database')
    const recovered = await openWrappedDatabase(file)
    closers.push(() => {
      try {
        recovered.database?.close()
      } catch {
        /* already closed */
      }
      fs.rmSync(opened.root, { recursive: true, force: true })
    })
    expect(recovered.recoveryPath).toBeTruthy()
    expect(fs.existsSync(recovered.recoveryPath!)).toBe(true)
    expect(recovered.database?.count('accounts')).toBe(0)
  })

  it('opens a database under a non-ASCII directory', async () => {
    const opened = await tempDatabase()
    const nested = path.join(opened.root, '数据', 'data', 'wrapped.sqlite')
    const next = await openWrappedDatabase(nested)
    closers.push(opened.close, () => next.database?.close())
    expect(next.database?.count('accounts')).toBe(0)
  })
})

describe('demo', () => {
  it('seeds 12 matches, 7 wins and a 58.3% win rate', async () => {
    const db = await openTemp()
    const now = Date.now()
    const seeded = seedDemo(db, now)
    const dash = queryDashboard(db, {
      accountId: seeded.accountId,
      preset: 'last30',
      customStart: null,
      customEnd: null,
      timeZone: 'UTC',
      locale: 'zh-CN',
      championId: null,
      augmentId: null,
      itemId: null
    }, { mode: 'demo', clientUnavailable: false })
    expect(dash.gamesText).toBe('12')
    expect(dash.winsText).toBe('7')
    expect(dash.lossesText).toBe('5')
    expect(dash.winRateText).toContain('58.3%')
    expect(dash.mode).toBe('demo')
    expect(dash.notices).toContain('demo-only')
    seedDemo(db, now + 40 * 24 * 60 * 60 * 1000)
    expect(db.count('matches')).toBe(12)
    expect(db.storageSummary(seeded.accountId).earliest).toBeGreaterThan(now)
  })
})

describe('sync', () => {
  it('restarts at the newest page after a budget stop and does not skip shifted ids', async () => {
    const db = await openTemp()
    const saved = account(db)
    const games = Array.from({ length: 25 }, (_value, index) => ({ id: String(index), start: 1_000_000 - index }))
    let injected = false
    const calls: string[] = []
    const result = await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async (_puuid, beg, end) => ({ games: games.slice(beg, end).map((game) => ({ gameId: game.id, platformId: 'NA1', queueId: 9000, gameCreation: game.start })) }),
        getGame: async (gameId) => {
          calls.push(gameId)
          if (!injected && calls.length === 10) {
            games.unshift({ id: 'new', start: 2_000_000 })
            injected = true
          }
          const game = games.find((item) => item.id === gameId)
          return { gameId, start: game?.start ?? 1 }
        }
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 5_000,
      sleep: async () => undefined,
      random: () => 0,
      paceMs: 0,
      budget: { maxCharged: 20, maxMs: 120_000 }
    })
    expect(result.termination).toBe('budget_entries')
    expect(db.readSyncState(saved.accountId)?.lastSuccessfulScan).toBeNull()
    const second = await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async (_puuid, beg, end) => ({ games: games.slice(beg, end).map((game) => ({ gameId: game.id, platformId: 'NA1', queueId: 9000, gameCreation: game.start })) }),
        getGame: async (gameId) => ({ gameId, start: games.find((item) => item.id === gameId)?.start ?? 1 })
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 6_000,
      sleep: async () => undefined,
      random: () => 0,
      paceMs: 0
    })
    expect(second.termination).toBe('empty_page')
    expect(db.count('matches')).toBe(26)
    expect(calls).not.toContain('new')
    expect(db.rawPayload('NA1', 'new')).not.toBeNull()
  })

  it('stops incremental sync only after the overlap and two quiet pages', async () => {
    const db = await openTemp()
    const saved = account(db)
    for (let index = 0; index < 80; index += 1) db.commitMatch(saved.accountId, mayhemMatch(`known-${index}`, 10_000 - index), 1)
    db.writeSyncState(saved.accountId, {
      lastSuccessfulScan: 1,
      latestSeenStart: 10_000,
      adapterVersion: 'test',
      continuation: { needsBackfill: false, partial: false, reason: 'empty_page', gaps: [], pendingIds: [], lastExhaustiveAt: 1, earliestAccessibleUtc: 1 }
    })
    const listed = [
      { id: 'known-0', start: 10_000 },
      ...Array.from({ length: 5 }, (_value, index) => ({ id: `new-${index}`, start: 20_000 - index })),
      ...Array.from({ length: 79 }, (_value, index) => ({ id: `known-${index + 1}`, start: 9_999 - index }))
    ]
    const fetched: string[] = []
    const result = await runSync({
      mode: 'incremental',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async (_puuid, beg, end) => ({ games: listed.slice(beg, end).map((game) => ({ gameId: game.id, platformId: 'NA1', queueId: 9000, gameCreation: game.start })) }),
        getGame: async (gameId) => {
          fetched.push(gameId)
          const game = listed.find((item) => item.id === gameId)
          return { gameId, start: game?.start ?? 1, marker: gameId.startsWith('known-') ? 'base' : 'fresh' }
        }
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 50_000,
      sleep: async () => undefined,
      random: () => 0,
      paceMs: 0,
      overlapCount: 40
    })
    expect(result.termination).toBe('overlap_stable')
    expect(db.count('matches')).toBe(85)
    expect(fetched).toContain('new-4')
    expect(fetched).toContain('known-0')
    expect(db.readSyncState(saved.accountId)?.lastSuccessfulScan).toBe(50_000)
  })

  it('terminates a repeated page and does not delete a match on 404', async () => {
    const db = await openTemp()
    const saved = account(db)
    db.commitMatch(saved.accountId, mayhemMatch('kept', 10), 1)
    const repeated = await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async () => ({ games: [{ gameId: 'kept', platformId: 'NA1', queueId: 9000, gameCreation: 10 }] }),
        getGame: async () => ({ gameId: 'kept', start: 10 })
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 10,
      sleep: async () => undefined,
      paceMs: 0
    })
    expect(repeated.termination).toBe('repeated_page')
    expect(db.readSyncState(saved.accountId)?.continuation.partial).toBe(true)
    const missing = await runSync({
      mode: 'rebuild',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async (_puuid, beg) => beg === 0 ? { games: [{ gameId: 'kept', platformId: 'NA1', queueId: 9000, gameCreation: 10 }] } : { games: [] },
        getGame: async () => { throw new TransportError('http', 404) }
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 11,
      sleep: async () => undefined,
      paceMs: 0
    })
    expect(missing.unavailable).toBe(1)
    expect(db.rawPayload('NA1', 'kept')).not.toBeNull()
  })

  it('keeps games from a cached older page and then reads the requested window', async () => {
    const db = await openTemp()
    const saved = account(db)
    let calls = 0
    const result = await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async (_puuid, beg, end) => {
          calls += 1
          if (calls === 1) return { gameIndexBegin: 200, gameIndexEnd: 399, games: [{ gameId: 'older', platformId: 'NA1', queueId: 9000, gameCreation: 10 }] }
          if (beg === 0) return { gameIndexBegin: 0, gameIndexEnd: end, games: [{ gameId: 'newer', platformId: 'NA1', queueId: 9000, gameCreation: 20 }] }
          return { gameIndexBegin: beg, gameIndexEnd: end, games: [] }
        },
        getGame: async (gameId) => ({ gameId, start: gameId === 'older' ? 10 : 20 })
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 8_000,
      sleep: async () => undefined,
      random: () => 0,
      paceMs: 0
    })
    expect(result.termination).toBe('empty_page')
    expect(db.rawPayload('NA1', 'older')).not.toBeNull()
    expect(db.rawPayload('NA1', 'newer')).not.toBeNull()
  })

  it('keeps repeated cached pages partial because gameCount is only the page size', async () => {
    const db = await openTemp()
    const saved = account(db)
    expect(listGameCount({ games: { gameCount: 2, games: [] } })).toBe(2)
    const result = await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async () => ({ gameCount: 1, games: [{ gameId: 'kept', platformId: 'NA1', queueId: 9000, gameCreation: 10 }] }),
        getGame: async () => ({ gameId: 'kept', start: 10 })
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 12,
      sleep: async () => undefined,
      paceMs: 0
    })
    expect(result.termination).toBe('repeated_page')
    expect(result.discovered).toBe(1)
    const state = db.readSyncState(saved.accountId)
    expect(state?.continuation.partial).toBe(true)
    expect(state?.continuation.needsBackfill).toBe(true)
    expect(state?.lastSuccessfulScan).toBeNull()
  })

  it('rediscoveres once on 401, stops on 403, and retries a 500 twice', async () => {
    const db = await openTemp()
    const saved = account(db)
    let rediscoveries = 0
    let lists = 0
    const sleeps: number[] = []
    await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async (_puuid, beg) => {
          lists += 1
          if (lists === 1) throw new TransportError('http', 401)
          if (beg > 0) return { games: [] }
          return { games: [{ gameId: 'only', platformId: 'NA1', queueId: 9000, gameCreation: 100 }] }
        },
        getGame: async (gameId) => ({ gameId, start: 100 })
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 100,
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0,
      paceMs: 0,
      rediscover: async () => { rediscoveries += 1 }
    })
    expect(rediscoveries).toBe(1)
    const forbidden = await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async () => { throw new TransportError('http', 403) },
        getGame: async () => ({})
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 200,
      sleep: async () => undefined,
      paceMs: 0
    })
    expect(forbidden.termination).toBe('capability_forbidden')
    let attempts = 0
    await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => ({ platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }),
        listMatches: async (_puuid, beg) => {
          if (beg > 0) return { games: [] }
          attempts += 1
          if (attempts < 3) throw new TransportError('http', 500)
          return { games: [{ gameId: 'retried', platformId: 'NA1', queueId: 9000, gameCreation: 300 }] }
        },
        getGame: async (gameId) => ({ gameId, start: 300 })
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 300,
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0,
      paceMs: 0
    })
    expect(attempts).toBe(3)
    expect(sleeps).toContain(1000)
    expect(sleeps).toContain(2000)
  })

  it('cancels when the signed-in account changes before another commit', async () => {
    const db = await openTemp()
    const saved = account(db)
    let calls = 0
    const result = await runSync({
      mode: 'backfill',
      adapter: testAdapter(),
      transport: {
        currentSummoner: async () => {
          calls += 1
          if (calls > 2) return { platformId: 'NA1', puuid: 'other', alias: 'Other' }
          return { platformId: 'NA1', puuid: 'self-puuid', alias: 'Tester' }
        },
        listMatches: async (_puuid, beg) => beg === 0 ? { games: [{ gameId: 'a', platformId: 'NA1', queueId: 9000, gameCreation: 1 }, { gameId: 'b', platformId: 'NA1', queueId: 9000, gameCreation: 2 }] } : { games: [] },
        getGame: async (gameId) => ({ gameId, start: gameId === 'a' ? 1 : 2 })
      },
      repo: db,
      account: { accountId: saved.accountId, platformId: 'NA1', puuid: 'self-puuid' },
      now: () => 1,
      sleep: async () => undefined,
      paceMs: 0
    })
    expect(result.termination).toBe('account_changed')
    expect(db.count('matches')).toBe(0)
  })
})

describe('security and export', () => {
  it('rejects non-loopback targets and keeps secrets out of logs', () => {
    expect(() => planLoopbackGet(2999, '/lol-summoner/v1/current-summoner')).toThrow(TransportError)
    expect(() => planLoopbackGet(2999, 'https://example.com/')).toThrow(TransportError)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-log-'))
    const logger = new Logger(root, 64)
    logger.info('probe', { password: 'hunter2', authorization: 'Basic abc', puuid: 'player-puuid' })
    const text = fs.readFileSync(path.join(root, 'app.log'), 'utf8')
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('player-puuid')
    expect(text).not.toContain('Basic abc')
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('does not search past the preferred directory when its lockfile is stale', () => {
    const reads: string[] = []
    const found = discoverInstall({
      preferredDir: 'D:\\Games\\League',
      readFile: (file) => {
        reads.push(file)
        return 'LeagueClient:1:2999:secret:https'
      },
      pidAlive: () => true
    })
    expect(found.state).toBe('wrong-service')
    expect(reads).toEqual([path.join('D:\\Games\\League', 'lockfile')])
  })

  it('writes nothing when export is canceled and reports a full disk', async () => {
    const canceled = await runExport({
      freeze: () => undefined,
      choosePath: async () => null,
      render: async () => { throw new Error('should-not-render') }
    })
    expect(canceled).toMatchObject({ canceled: true })
    const full = await runExport({
      freeze: () => undefined,
      choosePath: async () => 'C:\\temp\\wrapped.png',
      render: async () => png(),
      write: async () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }) }
    })
    expect(full).toMatchObject({ ok: false, code: 'disk_full' })
  })
})

function png(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 1600)
  view.setUint32(20, 2000)
  return bytes
}

function testAdapter() {
  return {
    version: 'test',
    indexMode: 'endExclusive' as const,
    pageSize: 20,
    adaptList(payload: unknown): ListedMatch[] {
      const games = (payload as { games: Array<Record<string, unknown>> }).games
      return games.map((game) => ({
        platformId: 'NA1',
        gameId: String(game.gameId),
        queueId: 9000,
        startUtc: Number(game.gameCreation)
      }))
    },
    adaptDetail(payload: unknown): NormalizedMatch {
      const record = payload as { gameId: string; start: number; marker?: string }
      return mayhemMatch(record.gameId, record.start, { marker: record.marker ?? 'base' })
    }
  }
}
