import { buildRecapExtras, type RecapFactCard, type AramChallengeCard, type PING_FIELDS } from './recap-extras'
import { asIdString } from './ids'
import type { Locale } from './types'

export const POSTER_CARD_KEYS = [
  'mostKills',
  'mostDeaths',
  'mostAssists',
  'damageDealt',
  'largestCrit',
  'damageTaken',
  'killsPerMin',
  'deathsPerMin',
  'assistsPerMin',
  'damagePerMin',
  'longestGame',
  'bestKda'
] as const

export type PosterCardKey = (typeof POSTER_CARD_KEYS)[number]

export interface PosterCard {
  key: PosterCardKey
  championId: number | null
  value: string
  durationText: string
  kills: number | null
  deaths: number | null
  assists: number | null
}

export interface PlayedWithRow {
  playerKey: string
  playerId: string
  championId: number | null
  profileIconId: number | null
  games: number
  wins: number
}

export const CHALLENGE_KEYS = [
  'highDamage',
  'penta',
  'quadra',
  'triple',
  'flawless',
  'firstTower',
  'quickGame',
  'turret',
  'longGame',
  'tenKills'
] as const

export type ChallengeKey = (typeof CHALLENGE_KEYS)[number]

export interface ChallengeCard {
  key: ChallengeKey
  games: number
  eligible: number
}

export interface PosterFacts {
  cards: PosterCard[]
  playedWith: PlayedWithRow[]
  playedWithPlayerCount?: number
  challenges: ChallengeCard[]
  championExtras?: Record<string, { penta: number | null; quadra: number | null; triple: number | null }>
  pings?: Record<keyof typeof PING_FIELDS, number | null>
  funCards?: RecapFactCard[]
  aramChallenges?: AramChallengeCard[]
  summary?: { totalDamage: number | null; takedowns: number | null; killParticipation: number | null; penta: number | null; quadra: number | null; triple: number | null; winsFewerKills: number | null; lossesMoreKills: number | null; winStreak: number; lossStreak: number }
  flashSlot?: 1 | 2 | null
}

export interface StoredGameInput {
  startUtc?: number
  championId: number | null
  resultState: string
  kills: number | null
  deaths: number | null
  assists: number | null
  championDamage: number | null
  durationSeconds: number | null
  selfParticipantId: string | null
  raw: unknown
}

interface GameView {
  startUtc: number | null
  teamDamage: number | null
  teamKills: number | null
  enemyKills: number | null
  extraStats: Record<string, unknown> | null
  championId: number | null
  resultState: string
  kills: number | null
  deaths: number | null
  assists: number | null
  championDamage: number | null
  damageTaken: number | null
  largestCrit: number | null
  durationSeconds: number | null
  allies: Array<{ playerKey: string; playerId: string; championId: number; profileIconId: number | null }>
  flashSlot: 1 | 2 | null
  pentaKills: number | null
  quadraKills: number | null
  tripleKills: number | null
  firstTowerKill: boolean | null
  turretKills: number | null
}

export function readStoredGame(input: StoredGameInput): GameView {
  const self = findSelf(input.raw, input.selfParticipantId)
  const stats = self ? statsOf(self) : null
  return {
    startUtc: input.startUtc ?? null,
    teamDamage: self ? teamTotal(input.raw, self, 'totalDamageDealtToChampions') : null,
    teamKills: self ? teamTotal(input.raw, self, 'kills') : null,
    enemyKills: self ? enemyTotal(input.raw, self) : null,
    extraStats: stats,
    championId: self ? integerOrNull(self.championId) ?? input.championId : input.championId,
    resultState: input.resultState,
    kills: readNumber(stats, 'kills') ?? input.kills,
    deaths: readNumber(stats, 'deaths') ?? input.deaths,
    assists: readNumber(stats, 'assists') ?? input.assists,
    championDamage: readNumber(stats, 'totalDamageDealtToChampions') ?? input.championDamage,
    damageTaken: readNumber(stats, 'totalDamageTaken'),
    largestCrit: readNumber(stats, 'largestCriticalStrike'),
    durationSeconds: input.durationSeconds,
    allies: self ? alliesOf(input.raw, self) : [],
    flashSlot: self?.spell1Id === 4 ? 1 : self?.spell2Id === 4 ? 2 : null,
    pentaKills: readNumber(stats, 'pentaKills'),
    quadraKills: readNumber(stats, 'quadraKills'),
    tripleKills: readNumber(stats, 'tripleKills'),
    firstTowerKill: readBool(stats, 'firstTowerKill'),
    turretKills: readNumber(stats, 'turretKills')
  }
}

export function buildPosterFacts(games: GameView[], locale: Locale, perfectLabel: string, timeZone = 'UTC'): PosterFacts {
  const cards: PosterCard[] = POSTER_CARD_KEYS.map((key) => {
    const best = maxBy(games, (game) => metricOf(game, key))
    return {
      key,
      championId: best?.championId ?? null,
      value: best ? formatMetric(best, key, locale, perfectLabel) : '—',
      durationText: best?.durationSeconds != null ? formatDuration(best.durationSeconds, locale) : '—',
      kills: best?.kills ?? null, deaths: best?.deaths ?? null, assists: best?.assists ?? null
    }
  })
  const championExtras: NonNullable<PosterFacts['championExtras']> = {}
  for (const game of games) { if (game.championId == null) continue; const row = championExtras[game.championId] ?? { penta: null, quadra: null, triple: null }; for (const [key, value] of [['penta', game.pentaKills], ['quadra', game.quadraKills], ['triple', game.tripleKills]] as const) { if (value != null) row[key] = (row[key] ?? 0) + value }; championExtras[game.championId] = row }
  const d = games.filter(g => g.flashSlot === 1).length; const f = games.filter(g => g.flashSlot === 2).length
  const teammates = playedWith(games)
  return { ...buildRecapExtras(games, locale, timeZone), summary: summaryOf(games), cards, playedWith: teammates.slice(0,8), playedWithPlayerCount: teammates.length, challenges: challengesOf(games), championExtras, flashSlot: d + f === 0 ? null : d >= f ? 1 : 2 }
}

export function emptyPosterFacts(): PosterFacts {
  return {
    cards: POSTER_CARD_KEYS.map((key) => ({ key, championId: null, value: '—', durationText: '—', kills: null, deaths: null, assists: null })),
    playedWith: [],
    challenges: []
  }
}

function challengesOf(games: GameView[]): ChallengeCard[] {
  const cards = CHALLENGE_KEYS.flatMap((key) => {
    let gamesHit = 0
    let eligible = 0
    for (const game of games) {
      const hit = challengeHit(game, key)
      if (hit == null) continue
      eligible += 1
      if (hit) gamesHit += 1
    }
    return eligible > 0 ? [{ key, games: gamesHit, eligible }] : []
  })
  return cards.slice(0, 8)
}

function challengeHit(game: GameView, key: ChallengeKey): boolean | null {
  const minutes = game.durationSeconds != null && game.durationSeconds > 0 ? game.durationSeconds / 60 : null
  if (key === 'highDamage') {
    const damage = rate(game.championDamage, minutes)
    return damage == null ? null : damage >= 1800
  }
  if (key === 'penta') return game.pentaKills == null ? null : game.pentaKills > 0
  if (key === 'quadra') return game.quadraKills == null ? null : game.quadraKills > 0
  if (key === 'triple') return game.tripleKills == null ? null : game.tripleKills > 0
  if (key === 'flawless') {
    if (game.deaths == null || (game.resultState !== 'win' && game.resultState !== 'loss')) return null
    return game.resultState === 'win' && game.deaths === 0
  }
  if (key === 'firstTower') return game.firstTowerKill == null ? null : game.firstTowerKill
  if (key === 'quickGame') return game.durationSeconds != null && game.durationSeconds > 0 ? game.durationSeconds < 13 * 60 : null
  if (key === 'turret') return game.turretKills == null ? null : game.turretKills > 0
  if (key === 'longGame') return game.durationSeconds != null && game.durationSeconds > 0 ? game.durationSeconds >= 30 * 60 : null
  return game.kills == null ? null : game.kills >= 10
}

function playedWith(games: GameView[]): PlayedWithRow[] {
  const totals = new Map<string, { playerId: Map<string, number>; championId: Map<number, number>; profileIcons: Map<number, number>; games: number; wins: number }>()
  for (const game of games) {
    const seen = new Set<string>()
    for (const ally of game.allies) {
      if (seen.has(ally.playerKey)) continue
      seen.add(ally.playerKey)
      const row = totals.get(ally.playerKey) ?? { playerId: new Map(), championId: new Map(), profileIcons: new Map(), games: 0, wins: 0 }
      row.games += 1
      if (game.resultState === 'win') row.wins += 1
      row.playerId.set(ally.playerId, (row.playerId.get(ally.playerId) ?? 0) + 1)
      row.championId.set(ally.championId, (row.championId.get(ally.championId) ?? 0) + 1)
      if (ally.profileIconId != null) row.profileIcons.set(ally.profileIconId, (row.profileIcons.get(ally.profileIconId) ?? 0) + 1)
      totals.set(ally.playerKey, row)
    }
  }
  return [...totals.entries()].map(([playerKey, row]) => ({
    playerKey,
    playerId: mostCommon(row.playerId) ?? playerKey,
    championId: mostCommon(row.championId),
    profileIconId: mostCommon(row.profileIcons),
    games: row.games,
    wins: row.wins
  })).sort((left, right) => right.games - left.games || right.wins - left.wins || left.playerId.localeCompare(right.playerId))
}

function mostCommon<T>(counts: Map<T, number>): T | null {
  let best: T | null = null
  let max = 0
  for (const [value, count] of counts) {
    if (count > max) {
      max = count
      best = value
    }
  }
  return best
}

function metricOf(game: GameView, key: PosterCardKey): number | null {
  const minutes = game.durationSeconds != null && game.durationSeconds > 0 ? game.durationSeconds / 60 : null
  if (key === 'mostKills') return game.kills
  if (key === 'mostDeaths') return game.deaths
  if (key === 'mostAssists') return game.assists
  if (key === 'damageDealt') return game.championDamage
  if (key === 'largestCrit') return game.largestCrit
  if (key === 'damageTaken') return game.damageTaken
  if (key === 'killsPerMin') return rate(game.kills, minutes)
  if (key === 'deathsPerMin') return rate(game.deaths, minutes)
  if (key === 'assistsPerMin') return rate(game.assists, minutes)
  if (key === 'damagePerMin') return rate(game.championDamage, minutes)
  if (key === 'longestGame') return game.durationSeconds
  if (game.kills == null || game.deaths == null || game.assists == null) return null
  return game.deaths === 0 ? game.kills + game.assists : (game.kills + game.assists) / game.deaths
}

function formatMetric(game: GameView, key: PosterCardKey, locale: Locale, perfectLabel: string): string {
  const value = metricOf(game, key)
  if (value == null) return '—'
  if (key === 'longestGame') return formatDuration(value, locale)
  if (key === 'bestKda' && game.deaths === 0) return perfectLabel
  if (key === 'killsPerMin' || key === 'deathsPerMin' || key === 'assistsPerMin') return formatNumber(value, locale, 3)
  if (key === 'bestKda') return formatNumber(value, locale, 1)
  return formatNumber(value, locale, 0)
}

function rate(value: number | null, minutes: number | null): number | null {
  if (value == null || minutes == null || minutes <= 0) return null
  return value / minutes
}

function maxBy(games: GameView[], read: (game: GameView) => number | null): GameView | null {
  let best: GameView | null = null
  let max: number | null = null
  for (const game of games) {
    const value = read(game)
    if (value == null || !Number.isFinite(value)) continue
    if (max == null || value > max) {
      max = value
      best = game
    }
  }
  return best
}

function findSelf(raw: unknown, selfParticipantId: string | null): Record<string, unknown> | null {
  if (!selfParticipantId) return null
  return participantsOf(raw).find((participant) => asIdString(participant.participantId) === selfParticipantId) ?? null
}

function alliesOf(raw: unknown, self: Record<string, unknown>): Array<{ playerKey: string; playerId: string; championId: number; profileIconId: number | null }> {
  const teamId = integerOrNull(self.teamId)
  const selfId = asIdString(self.participantId)
  if (teamId == null || !selfId) return []
  const names = playerNames(raw)
  const allies: Array<{ playerKey: string; playerId: string; championId: number; profileIconId: number | null }> = []
  for (const participant of participantsOf(raw)) {
    if (integerOrNull(participant.teamId) !== teamId) continue
    const participantId = asIdString(participant.participantId)
    if (!participantId || participantId === selfId) continue
    const named = names.get(participantId)
    const championId = integerOrNull(participant.championId)
    if (!named || championId == null || championId <= 0) continue
    allies.push({ ...named, championId })
  }
  return allies
}

function playerNames(raw: unknown): Map<string, { playerKey: string; playerId: string; profileIconId: number | null }> {
  const names = new Map<string, { playerKey: string; playerId: string; profileIconId: number | null }>()
  if (!raw || typeof raw !== 'object') return names
  const list = (raw as { participantIdentities?: unknown }).participantIdentities
  if (!Array.isArray(list)) return names
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const participantId = asIdString(record.participantId)
    const playerKey = record.playerKey
    const playerId = record.playerId
    if (!participantId || typeof playerKey !== 'string' || !/^[a-f0-9]{16}$/.test(playerKey)) continue
    if (typeof playerId !== 'string' || playerId.length < 1 || playerId.length > 40) continue
    const player = record.player && typeof record.player === 'object' ? record.player as Record<string, unknown> : null
    names.set(participantId, { playerKey, playerId, profileIconId: integerOrNull(player?.profileIcon) })
  }
  return names
}

function participantsOf(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { participants?: unknown }).participants
  if (!Array.isArray(list)) return []
  return list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
}

function statsOf(participant: Record<string, unknown>): Record<string, unknown> | null {
  const stats = participant.stats
  return stats && typeof stats === 'object' ? stats as Record<string, unknown> : null
}

function readNumber(stats: Record<string, unknown> | null, key: string): number | null {
  if (!stats || !(key in stats)) return null
  return typeof stats[key] === 'number' && Number.isFinite(stats[key]) ? stats[key] : null
}

function readBool(stats: Record<string, unknown> | null, key: string): boolean | null {
  if (!stats || !(key in stats) || typeof stats[key] !== 'boolean') return null
  return stats[key]
}

function integerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function formatNumber(value: number, locale: Locale, digits: number): string {
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value)
}

function formatDuration(seconds: number, locale: Locale): string {
  const minutes = Math.floor(seconds / 60)
  const remain = Math.floor(seconds % 60)
  if (locale === 'zh-CN') return `${minutes}分${String(remain).padStart(2, '0')}秒`
  return `${minutes}m ${String(remain).padStart(2, '0')}s`
}

function teamTotal(raw: unknown, self: Record<string,unknown>, field: string): number | null { const teamId=integerOrNull(self.teamId); if(teamId==null)return null; const team=participantsOf(raw).filter(p=>integerOrNull(p.teamId)===teamId); if(team.length!==5)return null; const values=team.map(p=>readNumber(statsOf(p),field)); if(values.some(v=>v==null))return null; return values.reduce<number>((sum,v)=>sum+(v??0),0) }

function summaryOf(games:GameView[]): NonNullable<PosterFacts['summary']> {
  const sum=(values:Array<number|null>)=>{const good=values.filter((v):v is number=>v!=null);return good.length?good.reduce((a,b)=>a+b,0):null}
  const kp=games.filter(g=>g.kills!=null&&g.assists!=null&&g.teamKills!=null&&g.teamKills>0)
  const teamGames=games.filter(g=>g.teamKills!=null&&g.enemyKills!=null)
  let win=0,loss=0,winStreak=0,lossStreak=0
  for(const g of [...games].sort((a,b)=>(a.startUtc??0)-(b.startUtc??0))){win=g.resultState==='win'?win+1:0;loss=g.resultState==='loss'?loss+1:0;winStreak=Math.max(winStreak,win);lossStreak=Math.max(lossStreak,loss)}
  return {totalDamage:sum(games.map(g=>g.championDamage)),takedowns:sum(games.map(g=>g.kills!=null&&g.assists!=null?g.kills+g.assists:null)),killParticipation:kp.length?kp.reduce((a,g)=>a+g.kills!+g.assists!,0)/kp.reduce((a,g)=>a+g.teamKills!,0):null,penta:sum(games.map(g=>g.pentaKills)),quadra:sum(games.map(g=>g.quadraKills)),triple:sum(games.map(g=>g.tripleKills)),winsFewerKills:teamGames.length?teamGames.filter(g=>g.resultState==='win'&&g.teamKills!<g.enemyKills!).length:null,lossesMoreKills:teamGames.length?teamGames.filter(g=>g.resultState==='loss'&&g.teamKills!>g.enemyKills!).length:null,winStreak,lossStreak}
}
function enemyTotal(raw:unknown,self:Record<string,unknown>):number|null {if(!raw||typeof raw!=='object'||!Array.isArray((raw as Record<string,unknown>).participants))return null;const opponents=((raw as Record<string,unknown>).participants as Record<string,unknown>[]).filter(p=>p.teamId!=null&&self.teamId!=null&&p.teamId!==self.teamId);if(opponents.length!==5)return null;const kills=opponents.map(p=>readNumber(statsOf(p),'kills'));return kills.every((v):v is number=>v!=null)?kills.reduce((a,b)=>a+b,0):null}
