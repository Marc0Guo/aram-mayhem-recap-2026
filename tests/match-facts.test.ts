import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPosterFacts, readStoredGame } from '../src/shared/match-facts'

describe('match facts', () => {
  it('reads self damage, crit, and same-team champions from a stored detail', () => {
    const raw = JSON.parse(readFileSync('fixtures/lcu/mayhem.sanitized.json', 'utf8')) as unknown
    const game = readStoredGame({
      championId: null,
      resultState: 'loss',
      kills: null,
      deaths: null,
      assists: null,
      championDamage: null,
      durationSeconds: 1522,
      selfParticipantId: '9',
      raw
    })
    expect(game.championId).toBe(42)
    expect(game.kills).toBe(28)
    expect(game.championDamage).toBe(141393)
    expect(game.damageTaken).toBe(91798)
    expect(game.largestCrit).toBe(1608)
    expect(game.flashSlot).toBe(2)
    expect(game.allies).toEqual([])
    const poster = buildPosterFacts([game], 'zh-CN', '完美')
    expect(poster.cards.find((card) => card.key === 'largestCrit')).toEqual({ key: 'largestCrit', championId: 42, value: '1,608', durationText: '25分22秒', kills: 28, deaths: 20, assists: 28 })
    expect(poster.cards.find((card) => card.key === 'damageTaken')?.value).toBe('91,798')
    expect(poster.cards.find((card) => card.key === 'mostKills')?.value).toBe('28')
    expect(poster.cards).toHaveLength(12)
    expect(poster.championExtras?.['42']).toEqual({ penta: 0, quadra: 1, triple: 2 })
    expect(poster.flashSlot).toBe(2)
    expect(poster.playedWith).toEqual([])
    const challenges = Object.fromEntries(poster.challenges.map((card) => [card.key, card]))
    expect(poster.challenges).toHaveLength(8)
    expect(challenges.highDamage).toEqual({ key: 'highDamage', games: 1, eligible: 1 })
    expect(challenges.penta).toEqual({ key: 'penta', games: 0, eligible: 1 })
    expect(challenges.quadra).toEqual({ key: 'quadra', games: 1, eligible: 1 })
    expect(challenges.triple).toEqual({ key: 'triple', games: 1, eligible: 1 })
    expect(challenges.firstTower).toEqual({ key: 'firstTower', games: 1, eligible: 1 })
    expect(challenges.turret).toEqual({ key: 'turret', games: 1, eligible: 1 })
    expect(challenges.flawless).toEqual({ key: 'flawless', games: 0, eligible: 1 })
    expect(challenges.quickGame).toEqual({ key: 'quickGame', games: 0, eligible: 1 })
  })

  it('leaves crit and damage taken unavailable when the raw detail has no stats', () => {
    const poster = buildPosterFacts([readStoredGame({
      championId: 157,
      resultState: 'win',
      kills: 4,
      deaths: 1,
      assists: 8,
      championDamage: 12000,
      durationSeconds: 900,
      selfParticipantId: null,
      raw: { synthetic: true }
    })], 'en', 'Perfect')
    expect(poster.cards.find((card) => card.key === 'largestCrit')?.value).toBe('—')
    expect(poster.cards.find((card) => card.key === 'damageTaken')?.value).toBe('—')
    expect(poster.cards.find((card) => card.key === 'mostKills')).toEqual({ key: 'mostKills', championId: 157, value: '4', durationText: '15m 00s', kills: 4, deaths: 1, assists: 8 })
    expect(poster.playedWith).toEqual([])
    expect(poster.challenges.map((card) => card.key)).toEqual(['highDamage', 'flawless', 'quickGame', 'longGame', 'tenKills'])
    expect(poster.challenges.every((card) => card.games === 0 && card.eligible === 1)).toBe(true)
  })

  it('groups teammates by player id', () => {
    const ally = (participantId: string, championId: number) => ({ participantId, teamId: 100, championId })
    const identity = (participantId: string, playerKey: string, playerId: string) => ({ participantId, playerKey, playerId })
    const game = (resultState: string, identities: ReturnType<typeof identity>[], participants: ReturnType<typeof ally>[]) => readStoredGame({
      championId: 42,
      resultState,
      kills: 1,
      deaths: 1,
      assists: 1,
      championDamage: 1000,
      durationSeconds: 900,
      selfParticipantId: '1',
      raw: { participantIdentities: identities, participants }
    })
    const poster = buildPosterFacts([
      game('win', [identity('1', 'aaaaaaaaaaaaaaaa', 'Self#NA1'), identity('2', 'bbbbbbbbbbbbbbbb', 'River#NA1')], [ally('1', 42), ally('2', 22)]),
      game('loss', [identity('1', 'aaaaaaaaaaaaaaaa', 'Self#NA1'), identity('2', 'bbbbbbbbbbbbbbbb', 'River#NA1')], [ally('1', 42), ally('2', 51)])
    ], 'zh-CN', '完美')
    expect(poster.playedWithPlayerCount).toBe(1)
    expect(poster.playedWith).toEqual([{ playerKey: 'bbbbbbbbbbbbbbbb', playerId: 'River#NA1', championId: 22, profileIconId: null, games: 2, wins: 1 }])
  })
})
