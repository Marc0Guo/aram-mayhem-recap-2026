import { describe, expect, it } from 'vitest'
import { REAL_CLIENT_IMPORT_VERIFIED } from '../src/shared/allowlist'
import { classifyQueue } from '../src/shared/classify'
import { computeMetrics } from '../src/shared/metrics'
import { parseLcuJson } from '../src/shared/ids'
import { redact } from '../src/shared/redact'
import { communityDragonFromClientPath, dataDragonImageUrl } from '../src/shared/asset-urls'
import { resolvePreset, zonedTimeToUtc } from '../src/shared/time'
import { formatKda, formatWinRate } from '../src/shared/present'
import type { MetricRow } from '../src/shared/types'
import { acceptHistoryPage, simulatePaging, widenHistoryWindow } from '../src/main/lcu/paging'

function row(patch: Partial<MetricRow> & Pick<MetricRow, 'gameId' | 'startUtc'>): MetricRow {
  return {
    platformId: 'NA1',
    durationSeconds: 1200,
    resultState: 'win',
    championId: 1,
    kills: 1,
    deaths: 1,
    assists: 1,
    championDamage: 1200,
    augmentStatus: 'recorded',
    augmentIds: [],
    itemsStatus: 'readable',
    itemIds: [3031],
    quarantined: false,
    ingestStatus: 'complete',
    modeClass: 'mayhem',
    selfParticipantId: null,
    ...patch
  }
}

describe('metrics', () => {
  it('computes the KDA, damage, and item oracles', () => {
    const metrics = computeMetrics([
      row({ gameId: 'a', startUtc: 1, kills: 10, deaths: 0, assists: 5, championDamage: 6000, durationSeconds: 600, itemIds: [3031, 3031, 0, 2052] }),
      row({ gameId: 'b', startUtc: 2, kills: 0, deaths: 5, assists: 5, championDamage: 12000, durationSeconds: 1200, resultState: 'loss', itemIds: [1001] }),
      row({ gameId: 'c', startUtc: 3, kills: 5, deaths: 5, assists: 0, championDamage: 100, durationSeconds: null, resultState: 'unknown', itemIds: [] })
    ], { startUtc: 0, endUtc: 10, timeZone: 'UTC' })
    expect(metrics.aggregateKda.value).toBe(2.5)
    expect(metrics.aggregateKda.perfect).toBe(false)
    expect(metrics.damagePerMin.value).toBe(600)
    expect(metrics.damagePerMin.eligibleN).toBe(2)
    expect(metrics.damagePerMin.excludedN).toBeGreaterThan(0)
    expect(metrics.items.rows.find((item) => item.itemId === 3031)?.count).toBe(1)
    expect(metrics.items.rows.some((item) => item.itemId === 2052)).toBe(false)
    expect(metrics.unknownOutcomes.value).toBe(1)
    expect(formatWinRate(0, 0, 'en')).toBe('—')
  })

  it('labels a deathless aggregate as perfect and keeps the numerator visible in the detail', () => {
    const metrics = computeMetrics([
      row({ gameId: 'a', startUtc: 1, kills: 4, deaths: 0, assists: 2 })
    ], { startUtc: 0, endUtc: 10, timeZone: 'UTC' })
    expect(metrics.aggregateKda.perfect).toBe(true)
    expect(metrics.aggregateKda.numerator).toBe(6)
    expect(formatKda(null, true, 'zh-CN')).toBe('完美')
    expect(formatKda(null, true, 'en')).toBe('Perfect')
  })

  it('counts an augment once per match and excludes ordinary or unknown queues', () => {
    const recorded = ['aug-blade', 'aug-shield', 'aug-shield', 'aug-tempo']
    const metrics = computeMetrics([
      row({ gameId: '1', startUtc: 1, augmentIds: ['aug-prism', 'aug-prism'] }),
      row({ gameId: '2', startUtc: 2, augmentIds: ['aug-prism'] }),
      row({ gameId: '3', startUtc: 3, augmentIds: ['aug-prism'] }),
      ...recorded.map((augmentId, index) => row({ gameId: `r${index}`, startUtc: 4 + index, augmentIds: [augmentId] })),
      row({ gameId: 'none', startUtc: 8, augmentStatus: 'explicitNone', augmentIds: [] }),
      ...[9, 10, 11, 12].map((startUtc) => row({ gameId: `u${startUtc}`, startUtc, augmentStatus: 'unavailable', augmentIds: [] })),
      row({ gameId: 'aram', startUtc: 13, modeClass: 'aram', augmentIds: ['aug-prism'] }),
      row({ gameId: 'unknown', startUtc: 14, modeClass: 'unknown' })
    ], { startUtc: 0, endUtc: 100, timeZone: 'UTC' })
    const prism = metrics.augments.rows.find((item) => item.augmentId === 'aug-prism')
    expect(metrics.games.value).toBe(12)
    expect(prism?.count).toBe(3)
    expect(prism?.percent).toBe(37.5)
    expect(metrics.augments.recordedMatches).toBe(8)
    expect(metrics.augments.totalMatches).toBe(12)
  })

  it('confirms queue 2400 only from the sanitized client fixture', () => {
    expect(REAL_CLIENT_IMPORT_VERIFIED).toBe(true)
    expect(classifyQueue(2400).modeClass).toBe('mayhem')
    expect(classifyQueue(2400).countsAsMayhem).toBe(true)
    expect(classifyQueue(450).countsAsMayhem).toBe(false)
    expect(classifyQueue(450).modeClass).toBe('unknown')
    expect(classifyQueue(null).modeClass).toBe('unknown')
  })
})

describe('time', () => {
  const zone = 'America/Los_Angeles'
  const now = Date.parse('2026-10-20T20:00:00.000Z')

  it('uses a half-open local interval, including the start and excluding the end', () => {
    const range = resolvePreset({ preset: 'custom', nowUtc: now, timeZone: zone, customStart: '2026-03-08', customEnd: '2026-03-08' })
    expect(range.startUtc).toBe(Date.parse('2026-03-08T08:00:00.000Z'))
    expect(range.endUtc).toBe(Date.parse('2026-03-09T07:00:00.000Z'))
    expect(range.startUtc).toBeLessThan(range.endUtc)
  })

  it('handles the 2026 Pacific fall-back and the Monday week before 20 October', () => {
    expect(zonedTimeToUtc(2026, 11, 1, 0, 0, 0, zone)).toBe(Date.parse('2026-11-01T07:00:00.000Z'))
    expect(zonedTimeToUtc(2026, 11, 2, 0, 0, 0, zone)).toBe(Date.parse('2026-11-02T08:00:00.000Z'))
    const week = resolvePreset({ preset: 'lastWeek', nowUtc: now, timeZone: zone })
    expect(week.startDate).toBe('2026-10-12')
    expect(week.endDate).toBe('2026-10-18')
    expect(week.startUtc).toBe(Date.parse('2026-10-12T07:00:00.000Z'))
    expect(week.endUtc).toBe(Date.parse('2026-10-19T07:00:00.000Z'))
  })

  it('includes the leap day in America/Los_Angeles', () => {
    const range = resolvePreset({ preset: 'custom', nowUtc: Date.parse('2028-03-01T00:00:00.000Z'), timeZone: zone, customStart: '2028-02-29', customEnd: '2028-02-29' })
    expect(range.startUtc).toBe(Date.parse('2028-02-29T08:00:00.000Z'))
    expect(range.endUtc).toBe(Date.parse('2028-03-01T08:00:00.000Z'))
  })
})

describe('boundaries', () => {
  it('shows that an inclusive client against an exclusive server skips an id', () => {
    expect(widenHistoryWindow(0, 20)).toEqual({ begIndex: 0, endIndex: 199 })
    expect(widenHistoryWindow(20, 40)).toEqual({ begIndex: 20, endIndex: 219 })
    expect(simulatePaging(25, 20, 'endExclusive', 'endExclusive')).toHaveLength(25)
    const skipped = simulatePaging(25, 20, 'endExclusive', 'endInclusive')
    expect(skipped).not.toContain('19')
  })

  it('rejects a cached history page unless it is the window that was requested', () => {
    const cached = { games: { gameIndexBegin: 200, gameIndexEnd: 399, games: [{ gameId: '1' }] } }
    expect(acceptHistoryPage({ payload: cached, begIndex: 0, endIndex: 199, elapsedMs: 50 })).toBe(false)
    expect(acceptHistoryPage({ payload: cached, begIndex: 200, endIndex: 399, elapsedMs: 50 })).toBe(true)
    const tiny = { games: { gameIndexBegin: 0, gameIndexEnd: 1, games: [{ gameId: '1' }, { gameId: '2' }] } }
    expect(acceptHistoryPage({ payload: tiny, begIndex: 0, endIndex: 199, elapsedMs: 40 })).toBe(false)
    expect(acceptHistoryPage({ payload: tiny, begIndex: 0, endIndex: 199, elapsedMs: 3000 })).toBe(true)
    const tail = { games: { gameIndexBegin: 400, gameIndexEnd: 449, games: [{ gameId: '1' }] } }
    expect(acceptHistoryPage({ payload: tail, begIndex: 400, endIndex: 599, elapsedMs: 80 })).toBe(true)
    expect(acceptHistoryPage({ payload: { games: [{ gameId: '1' }] }, begIndex: 0, endIndex: 20, elapsedMs: 1 })).toBe(true)
  })

  it('keeps a 16-digit game id as a string', () => {
    const parsed = parseLcuJson('{"gameId":12345678901234567}') as { gameId: string }
    expect(parsed.gameId).toBe('12345678901234567')
  })

  it('redacts secrets and builds a pinned asset path without appending a guessed extension', () => {
    const cleaned = JSON.stringify(redact({ password: 'secret', authorization: 'Basic abc', puuid: 'abc', body: 'LeagueClient:1234:2999:hunter2:https' }))
    expect(cleaned).not.toContain('hunter2')
    expect(cleaned).not.toContain('Basic abc')
    expect(communityDragonFromClientPath('15.20', '/lol-game-data/assets/ASSETS/UX/Foo.dds')).toBe(
      'https://raw.communitydragon.org/15.20/plugins/rcp-be-lol-game-data/global/default/assets/ux/foo.dds'
    )
    expect(dataDragonImageUrl('15.20.1', 'champion', 'Yasuo.png')).toContain('/img/champion/Yasuo.png')
  })
})
