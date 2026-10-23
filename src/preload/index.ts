import { contextBridge, ipcRenderer } from 'electron'
import type { AramApi, SyncView } from '@shared/bridge'

const api: AramApi & {
  pullExport: () => Promise<unknown>
  signalExportReady: () => void
} = {
  bootstrap: () => ipcRenderer.invoke('app.bootstrap'),
  dashboardQuery: (input) => ipcRenderer.invoke('dashboard.query', input),
  matchesList: (input) => ipcRenderer.invoke('matches.list', input),
  matchDetail: (input) => ipcRenderer.invoke('matches.detail', input),
  syncStart: (input) => ipcRenderer.invoke('sync.start', input),
  syncCancel: (input) => ipcRenderer.invoke('sync.cancel', input),
  assetsStatus: () => ipcRenderer.invoke('assets.status'),
  icons: (input) => ipcRenderer.invoke('assets.icons', input),
  exportPng: (input) => ipcRenderer.invoke('export.png', input),
  connectLeague: () => ipcRenderer.invoke('app.connect'),
  useDemo: () => ipcRenderer.invoke('app.demo'),
  useReal: () => ipcRenderer.invoke('app.real'),
  openLeague: () => ipcRenderer.invoke('app.openLeague'),
  retryDiscovery: () => ipcRenderer.invoke('app.retryDiscovery'),
  restoreDatabase: () => ipcRenderer.invoke('app.restore'),
  useFreshDatabase: () => ipcRenderer.invoke('app.fresh'),
  getSettings: () => ipcRenderer.invoke('settings.get'),
  updateSettings: (input) => ipcRenderer.invoke('settings.update', input),
  deleteAccount: (input) => ipcRenderer.invoke('account.delete', input),
  chooseLeagueFolder: () => ipcRenderer.invoke('dialog.leagueFolder'),
  openLocation: (kind) => ipcRenderer.invoke('shell.location', kind),
  onSyncProgress: (callback) => {
    const listener = (_event: unknown, payload: SyncView) => callback(payload)
    ipcRenderer.on('sync.progress', listener)
    return () => ipcRenderer.removeListener('sync.progress', listener)
  },
  pullExport: () => ipcRenderer.invoke('export.pull'),
  signalExportReady: () => ipcRenderer.send('export.ready')
}

contextBridge.exposeInMainWorld('aram', api)
