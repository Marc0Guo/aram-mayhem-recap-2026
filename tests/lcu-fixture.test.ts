import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { adaptCandidateDetail } from '../src/main/lcu/adapter'
import { platformFromPayloads } from '../src/main/lcu/session'
import { sanitizeRaw } from '../src/main/lcu/sanitize'

describe('sanitized Mayhem client fixture', () => {
  const fixture = JSON.parse(fs.readFileSync('fixtures/lcu/mayhem.sanitized.json', 'utf8')) as Record<string, unknown>

  it('keeps the real detail shape without account identifiers', () => {
    const leaked: string[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (['gameName', 'tagLine', 'summonerName', 'displayName', 'matchHistoryUri', 'accountId', 'currentAccountId'].includes(key)) leaked.push(key)
        if (key === 'puuid' && value !== 'self') leaked.push(String(value))
        walk(value)
      }
    }
    walk(fixture)
    expect(leaked).toEqual([])
    expect(fixture.queueId).toBe(2400)
    expect(fixture.gameMode).toBe('KIWI')
    expect(fixture.gameId).toBe('sanitized-mayhem-1')
  })

  it('maps self stats, seconds, and augment slots', () => {
    const match = adaptCandidateDetail(fixture, 'self')
    expect(match.modeClass).toBe('mayhem')
    expect(match.ingestStatus).toBe('complete')
    expect(match.selfParticipantId).toBeTruthy()
    expect(match.durationSeconds).toBe(1522)
    expect(match.resultState).toBe('loss')
    expect(match.patch).toBe('16.20.824.8524')
    const self = match.participants[0]
    expect(self?.augmentStatus).toBe('recorded')
    expect(self?.augments.map((augment) => augment.augmentId)).toEqual(['2141', '1336', '1092', '1238', '1243'])
    expect(self?.itemsStatus).toBe('readable')
    expect(self?.items).toHaveLength(7)
    expect(self?.kills).toEqual(expect.any(Number))
    const sanitized = sanitizeRaw(fixture, 'self')
    expect(JSON.stringify(sanitized.raw)).not.toContain('"puuid"')
  })

  it('keeps a riot id for teammates and drops the puuid', () => {
    const sanitized = sanitizeRaw({
      participantIdentities: [{
        participantId: 2,
        player: { puuid: 'teammate-secret', gameName: 'River', tagLine: 'NA1', summonerName: 'old' }
      }]
    }, 'self')
    const identity = (sanitized.raw as { participantIdentities: Array<Record<string, unknown>> }).participantIdentities[0]
    expect(identity?.playerId).toBe('River#NA1')
    expect(identity?.playerKey).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(sanitized.raw)).not.toContain('teammate-secret')
    expect(JSON.stringify(sanitized.raw)).not.toContain('gameName')
  })

  it('reads the region from the history wrapper when the summoner payload has none', () => {
    expect(platformFromPayloads(undefined, { platformId: 'NA1', games: { games: [] } })).toBe('NA1')
    expect(platformFromPayloads('EUW1', { platformId: 'NA1' })).toBe('EUW1')
    expect(platformFromPayloads(undefined, {})).toBeNull()
  })
})