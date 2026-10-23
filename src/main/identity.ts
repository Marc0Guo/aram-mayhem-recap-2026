import { createHash } from 'node:crypto'

export function accountIdFor(platformId: string, puuid: string): string {
  const digest = createHash('sha256').update(`${platformId}\n${puuid}`).digest('hex').slice(0, 24)
  return `acc_${digest}`
}

export function matchKey(platformId: string, gameId: string): string {
  return `${platformId}\n${gameId}`
}

export function splitMatchKey(key: string): { platformId: string; gameId: string } | null {
  const index = key.indexOf('\n')
  if (index <= 0) return null
  return { platformId: key.slice(0, index), gameId: key.slice(index + 1) }
}
