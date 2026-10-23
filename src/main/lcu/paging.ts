export type IndexMode = 'endExclusive' | 'endInclusive'

/** Inclusive span that asks the client for one 200-game page. A shorter end index can replace that page with a smaller cache. */
export const HISTORY_WINDOW = 199

/** A real history fetch is slower than a warm cache hit. A fast short page is the stale small cache, not the end of history. */
export const HISTORY_FETCH_MS = 2000

/** The client keeps one match-id page for several minutes. Poll until that page expires. */
export const HISTORY_CACHE_RETRY_MS = 15_000
export const HISTORY_CACHE_RETRIES = 80

export function readHistoryWindow(payload: unknown): { indexBegin: number | null; indexEnd: number | null; gameLength: number } {
  if (!payload || typeof payload !== 'object') return { indexBegin: null, indexEnd: null, gameLength: 0 }
  const record = payload as Record<string, unknown>
  const nested = record.games
  const holder = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : record
  const games = Array.isArray(holder.games) ? holder.games : Array.isArray(record.games) ? record.games : []
  return {
    indexBegin: indexField(holder, 'gameIndexBegin'),
    indexEnd: indexField(holder, 'gameIndexEnd'),
    gameLength: games.length
  }
}

function indexField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** True when this payload is the page that was requested. Unlabeled fixtures are accepted. */
export function acceptHistoryPage(input: { payload: unknown; begIndex: number; endIndex: number; elapsedMs: number }): boolean {
  const window = readHistoryWindow(input.payload)
  if (window.indexBegin == null || window.indexEnd == null) return true
  if (window.indexBegin !== input.begIndex) return false
  if (window.indexEnd === input.endIndex) return true
  if (window.gameLength === 0) return true
  const asked = input.endIndex - input.begIndex + 1
  if (!(asked > 0 && window.gameLength < asked)) return false
  if (window.indexBegin > 0) return true
  return input.elapsedMs >= HISTORY_FETCH_MS
}

export function widenHistoryWindow(begIndex: number, endIndex: number): { begIndex: number; endIndex: number } {
  const safeBeg = Number.isInteger(begIndex) && begIndex >= 0 ? begIndex : 0
  const safeEnd = Number.isInteger(endIndex) && endIndex > safeBeg ? endIndex : safeBeg + 1
  return { begIndex: safeBeg, endIndex: Math.max(safeEnd, safeBeg + HISTORY_WINDOW) }
}

export function pageBounds(offset: number, pageSize: number, mode: IndexMode): { begIndex: number; endIndex: number } {
  if (mode === 'endExclusive') return { begIndex: offset, endIndex: offset + pageSize }
  return { begIndex: offset, endIndex: offset + pageSize - 1 }
}

export function sliceByIndex<T>(items: T[], begIndex: number, endIndex: number, mode: IndexMode): T[] {
  if (mode === 'endExclusive') return items.slice(begIndex, endIndex)
  return items.slice(begIndex, endIndex + 1)
}

export function simulatePaging(count: number, pageSize: number, server: IndexMode, client: IndexMode): string[] {
  const ids = Array.from({ length: count }, (_value, index) => String(index))
  const seen: string[] = []
  let offset = 0
  for (let page = 0; page < 50; page += 1) {
    const bounds = pageBounds(offset, pageSize, client)
    const slice = sliceByIndex(ids, bounds.begIndex, bounds.endIndex, server)
    if (slice.length === 0) break
    seen.push(...slice)
    offset += pageSize
  }
  return [...new Set(seen)]
}
