import type { ApiResult, AramApi, SyncView } from '@shared/bridge'

async function call<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, body === undefined
      ? undefined
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return await response.json() as ApiResult<T>
  } catch {
    return { ok: false, error: { code: 'network', message: 'network', retryable: true, correlationId: 'web' } }
  }
}

export function installWebApi(): void {
  const api: AramApi = {
    bootstrap: () => call('/api/bootstrap'),
    dashboardQuery: (input) => call('/api/dashboard', input),
    matchesList: (input) => call('/api/matches', input),
    matchDetail: (input) => call('/api/detail', input),
    syncStart: (input) => call('/api/sync', input),
    syncCancel: (input) => call('/api/sync/cancel', input),
    assetsStatus: () => call('/api/assets'),
    icons: (input) => call('/api/icons', input),
    exportPng: async () => ({ ok: false, error: { code: 'unsupported', message: '网页版直接看这一页。', retryable: false, correlationId: 'web' } }),
    connectLeague: () => call('/api/connect'),
    useDemo: () => call('/api/demo'),
    useReal: () => call('/api/real'),
    openLeague: () => call('/api/open-league', {}),
    retryDiscovery: () => call('/api/discovery', {}),
    restoreDatabase: async () => ({ ok: false, error: { code: 'unsupported', message: 'unsupported', retryable: false, correlationId: 'web' } }),
    useFreshDatabase: async () => ({ ok: false, error: { code: 'unsupported', message: 'unsupported', retryable: false, correlationId: 'web' } }),
    getSettings: () => call('/api/bootstrap'),
    updateSettings: (input) => call('/api/settings', input),
    deleteAccount: (input) => call('/api/delete', input),
    chooseLeagueFolder: async () => ({ ok: true, data: { leagueDir: null } }),
    openLocation: (kind) => call('/api/location', { kind }),
    onSyncProgress: (callback) => {
      let after = 0
      let stopped = false
      let inFlight = false
      const tick = async () => {
        if (stopped || inFlight) return
        inFlight = true
        try {
          const result = await call<{ events: SyncView[]; cursor: number }>(`/api/events?after=${after}`)
          if (!result.ok || stopped) return
          after = result.data.cursor
          for (const event of result.data.events) callback(event)
        } finally { inFlight = false }
      }
      const timer = window.setInterval(() => { void tick() }, 1000)
      void tick()
      return () => {
        stopped = true
        window.clearInterval(timer)
      }
    }
  }
  window.aram = api as Window['aram']
}
