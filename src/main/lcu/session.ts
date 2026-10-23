import { parseLcuJson } from '@shared/ids'
import { AdapterError, TransportError } from './errors'
import { HISTORY_WINDOW, widenHistoryWindow } from './paging'
import { lcuGet } from './transport'
import type { SyncTransport } from '../sync/engine'

export interface LcuConnection {
  port: number
  authorization: string
}

export function platformFromPayloads(summonerPlatform: unknown, list: unknown): string | null {
  if (typeof summonerPlatform === 'string' && summonerPlatform) return summonerPlatform
  if (!list || typeof list !== 'object') return null
  const wrapper = list as Record<string, unknown>
  if (typeof wrapper.platformId === 'string' && wrapper.platformId) return wrapper.platformId
  return null
}

async function resolvePlatformId(
  summoner: Record<string, unknown>,
  puuid: string,
  call: (resourcePath: string, timeoutMs?: number) => Promise<unknown>,
  readCache: () => string | null,
  writeCache: (value: string) => void
): Promise<string> {
  const direct = platformFromPayloads(summoner.platformId, null)
  if (direct) {
    writeCache(direct)
    return direct
  }
  const cached = readCache()
  if (cached) return cached
  try {
    const window = widenHistoryWindow(0, HISTORY_WINDOW)
    const list = await call(`/lol-match-history/v1/products/lol/${encodeURIComponent(puuid)}/matches?begIndex=${window.begIndex}&endIndex=${window.endIndex}`, 45000)
    const found = platformFromPayloads(null, list)
    if (found) {
      writeCache(found)
      return found
    }
  } catch (error) {
    if (error instanceof TransportError) throw error
    return 'local'
  }
  return 'local'
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function createLiveTransport(getConnection: () => LcuConnection | null, offline: () => boolean): SyncTransport {
  let cachedPlatform: string | null = null
  const call = async (resourcePath: string, timeoutMs = 5000): Promise<unknown> => {
    const connection = getConnection()
    if (!connection) throw new TransportError('client_exited', 0)
    const response = await lcuGet({
      port: connection.port,
      resourcePath,
      authorization: connection.authorization,
      offline: offline(),
      timeoutMs
    })
    if (response.status === 401) throw new TransportError('http', 401)
    if (response.status === 403) throw new TransportError('http', 403)
    if (response.status === 404) throw new TransportError('http', 404)
    if (response.status === 429) {
      const seconds = Number(headerValue(response.headers['retry-after']))
      throw new TransportError('http', 429, Number.isFinite(seconds) ? seconds * 1000 : 1000)
    }
    if (response.status >= 500) throw new TransportError('http', response.status)
    if (response.status !== 200) throw new TransportError('http', response.status)
    try {
      return parseLcuJson(response.body)
    } catch {
      throw new TransportError('malformed_json', response.status)
    }
  }

  return {
    async currentSummoner() {
      const parsed = await call('/lol-summoner/v1/current-summoner')
      if (!parsed || typeof parsed !== 'object') throw new AdapterError('missing-identity')
      const record = parsed as Record<string, unknown>
      const puuid = typeof record.puuid === 'string' ? record.puuid : ''
      if (!puuid) throw new AdapterError('missing-identity')
      const gameName = typeof record.gameName === 'string' ? record.gameName : ''
      const tagLine = typeof record.tagLine === 'string' ? record.tagLine : ''
      const displayName = typeof record.displayName === 'string' ? record.displayName : ''
      const alias = gameName && tagLine ? `${gameName}#${tagLine}` : displayName || '召唤师'
      const platformId = await resolvePlatformId(record, puuid, call, () => cachedPlatform, (value) => { cachedPlatform = value })
      return { platformId, puuid, alias }
    },
    async listMatches(puuid, begIndex, endIndex) {
      const window = widenHistoryWindow(begIndex, endIndex)
      return call(`/lol-match-history/v1/products/lol/${encodeURIComponent(puuid)}/matches?begIndex=${window.begIndex}&endIndex=${window.endIndex}`, 45000)
    },
    async getGame(gameId) {
      return call(`/lol-match-history/v1/games/${encodeURIComponent(gameId)}`)
    }
  }
}
