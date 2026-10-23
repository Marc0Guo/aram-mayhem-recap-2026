import { createHash } from 'node:crypto'
import { asIdString } from '@shared/ids'

const SENSITIVE = new Set([
  'puuid',
  'summonerId',
  'summonerName',
  'riotIdName',
  'riotIdTagline',
  'accountId',
  'currentAccountId',
  'matchHistoryUri',
  'password',
  'authorization',
  'gameName',
  'tagLine',
  'displayName',
  'internalName',
  'privacy'
])

export function sanitizeRaw(value: unknown, selfPuuid: string): { raw: unknown; selfParticipantId: string | null } {
  let selfParticipantId: string | null = null
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map((entry) => walk(entry))
    if (!node || typeof node !== 'object') return node
    const record = node as Record<string, unknown>
    const participantId = asIdString(record.participantId)
    if (typeof record.puuid === 'string' && record.puuid === selfPuuid && participantId) {
      selfParticipantId = participantId
    }
    const output: Record<string, unknown> = {}
    const labeled = labelPlayer(record.player)
    if (labeled) {
      output.playerKey = labeled.playerKey
      output.playerId = labeled.playerId
    } else {
      const kept = keptPlayer(record)
      if (kept) {
        output.playerKey = kept.playerKey
        output.playerId = kept.playerId
      }
    }
    for (const [key, entry] of Object.entries(record)) {
      if (SENSITIVE.has(key) || key === 'playerKey' || key === 'playerId') continue
      output[key] = walk(entry)
    }
    return output
  }
  return { raw: walk(value), selfParticipantId }
}

function labelPlayer(value: unknown): { playerKey: string; playerId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const player = value as Record<string, unknown>
  const puuid = typeof player.puuid === 'string' ? player.puuid : ''
  const gameName = cleanToken(player.gameName)
  const tagLine = cleanToken(player.tagLine)
  if (!puuid || !gameName) return null
  const playerId = tagLine ? `${gameName}#${tagLine}` : gameName
  if (playerId.length > 40) return null
  return { playerKey: createHash('sha256').update(puuid).digest('hex').slice(0, 16), playerId }
}

function keptPlayer(record: Record<string, unknown>): { playerKey: string; playerId: string } | null {
  const playerKey = record.playerKey
  const playerId = record.playerId
  if (typeof playerKey !== 'string' || !/^[a-f0-9]{16}$/.test(playerKey)) return null
  if (typeof playerId !== 'string' || playerId.length < 1 || playerId.length > 40) return null
  return { playerKey, playerId }
}

function cleanToken(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f]/g, '').trim()
}
