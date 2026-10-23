import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { z } from 'zod'
import type { ApiResult } from '@shared/bridge'
import type { ExportSnapshot } from '@shared/types'
import { imageMediaType } from '@shared/asset-urls'
import { deleteAccountSchema, detailSchema, exportSchema, iconsSchema, listSchema, rangeSchema, settingsSchema, syncCancelSchema, syncStartSchema } from '@shared/schemas'
import { pngSize, runExport } from './export/write'
import { readPin } from './assets/cache'
import { hardenWindow, rendererSecurity } from './security'
import { AppRuntime } from './runtime'

protocol.registerSchemesAsPrivileged([
  { scheme: 'wrapped-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let runtime: AppRuntime | null = null
let mainWindow: BrowserWindow | null = null
let exportSnapshot: ExportSnapshot | null = null
let quitting = false

function correlationId(): string {
  return `c_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

function fail(code: string, message: string, retryable: boolean): ApiResult<never> {
  return { ok: false, error: { code, message, retryable, correlationId: correlationId() } }
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw Object.assign(new Error('invalid-input'), { code: 'invalid_input' })
  return result.data
}

async function guard<T>(work: () => Promise<T> | T): Promise<ApiResult<T>> {
  try {
    return ok(await work())
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' ? error.code : 'internal'
    const retryable = code === 'throttled' || code === 'client_unavailable' || code === 'offline'
    const message = code === 'invalid_input' ? '输入无效。' : code === 'schema_too_new' ? '数据库版本过新。' : code === 'throttled' ? '请稍后再试。' : code === 'client_unavailable' ? '客户端不可用。' : code === 'offline' ? '当前为离线模式。' : '操作没有完成。'
    return fail(code, message, retryable)
  }
}

function rendererUrl(page: string): string | null {
  const base = process.env.ELECTRON_RENDERER_URL
  if (!base) return null
  return new URL(page, base).toString()
}

function preloadPath(): string {
  return path.join(__dirname, '../preload/index.js')
}

function webPreferences() {
  return { ...rendererSecurity, preload: preloadPath() }
}

async function createWindow(): Promise<void> {
  const allowed = process.env.ELECTRON_RENDERER_URL ? [process.env.ELECTRON_RENDERER_URL] : []
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#071426',
    autoHideMenuBar: true,
    webPreferences: webPreferences()
  })
  hardenWindow(win, allowed)
  win.on('ready-to-show', () => win.show())
  mainWindow = win
  const devUrl = rendererUrl('index.html')
  if (devUrl) await win.loadURL(devUrl)
  else await win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

async function captureExport(snapshot: ExportSnapshot): Promise<Uint8Array> {
  exportSnapshot = snapshot
  const win = new BrowserWindow({
    width: 1600,
    height: 2000,
    show: false,
    useContentSize: true,
    backgroundColor: '#071426',
    webPreferences: webPreferences()
  })
  hardenWindow(win, process.env.ELECTRON_RENDERER_URL ? [process.env.ELECTRON_RENDERER_URL] : [])
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('export-timeout')), 15000)
    ipcMain.once('export.ready', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  const devUrl = rendererUrl('export.html')
  if (devUrl) await win.loadURL(devUrl)
  else await win.loadFile(path.join(__dirname, '../renderer/export.html'))
  await ready
  const overflow = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-export-root]')
    if (!root) return ['missing-root']
    return [...root.querySelectorAll('[data-export-part]')].filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => el.getAttribute('data-export-part'))
  })()`)
  if (Array.isArray(overflow) && overflow.length > 0) {
    win.destroy()
    throw new Error(`export-overflow:${overflow.join(',')}`)
  }
  let image = await win.webContents.capturePage()
  const size = image.getSize()
  if (size.width !== 1600 || size.height !== 2000) image = image.resize({ width: 1600, height: 2000, quality: 'best' })
  const png = image.toPNG()
  win.destroy()
  pngSize(png)
  return png
}

function registerIpc(): void {
  const appRuntime = runtime
  if (!appRuntime) return
  appRuntime.onProgress((progress) => {
    const contents = mainWindow?.webContents
    if (!contents || contents.isDestroyed()) return
    contents.send('sync.progress', progress)
  })
  ipcMain.handle('app.bootstrap', () => guard(() => appRuntime.bootstrap()))
  ipcMain.handle('app.connect', () => guard(() => appRuntime.connectAndSync()))
  ipcMain.handle('app.demo', () => guard(() => appRuntime.useDemo()))
  ipcMain.handle('app.real', () => guard(() => appRuntime.useReal()))
  ipcMain.handle('app.openLeague', () => guard(async () => {
    const opened = appRuntime.openLeague()
    if (!opened.ok) return { message: opened.message }
    const error = await shell.openPath(opened.message)
    return { message: error || 'opening' }
  }))
  ipcMain.handle('app.retryDiscovery', () => guard(() => appRuntime.refreshDiscovery()))
  ipcMain.handle('app.restore', () => guard(async () => {
    const recovery = appRuntime.bootstrap().recoveryPath
    if (!recovery) return appRuntime.bootstrap()
    return appRuntime.bootstrap()
  }))
  ipcMain.handle('app.fresh', () => guard(() => appRuntime.bootstrap()))
  ipcMain.handle('settings.get', () => guard(() => appRuntime.bootstrap()))
  ipcMain.handle('settings.update', (_event, input) => guard(() => appRuntime.updateSettings(parse(settingsSchema, input))))
  ipcMain.handle('account.delete', (_event, input) => guard(() => {
    const body = parse(deleteAccountSchema, input)
    return appRuntime.deleteAccount(body.accountId)
  }))
  ipcMain.handle('dialog.leagueFolder', () => guard(async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { leagueDir: null }
    appRuntime.setLeagueDir(result.filePaths[0])
    return { leagueDir: result.filePaths[0] }
  }))
  ipcMain.handle('shell.location', (_event, kind) => guard(async () => {
    const boot = appRuntime.bootstrap()
    const target = kind === 'logs' ? boot.logPath : boot.storagePath
    const error = await shell.openPath(target)
    return { opened: error.length === 0 }
  }))
  ipcMain.handle('dashboard.query', (_event, input) => guard(() => appRuntime.dashboard(parse(rangeSchema, input))))
  ipcMain.handle('matches.list', (_event, input) => guard(() => appRuntime.matches(parse(listSchema, input))))
  ipcMain.handle('matches.detail', (_event, input) => guard(() => {
    const detail = appRuntime.detail(parse(detailSchema, input))
    if (!detail) throw Object.assign(new Error('not-found'), { code: 'not_found' })
    return detail
  }))
  ipcMain.handle('sync.start', (_event, input) => guard(() => {
    const body = parse(syncStartSchema, input)
    return appRuntime.startSync(body.accountId, body.kind)
  }))
  ipcMain.handle('sync.cancel', (_event, input) => guard(async () => {
    const body = parse(syncCancelSchema, input)
    await appRuntime.cancel(body.runId)
    return { runId: body.runId }
  }))
  ipcMain.handle('assets.icons', (_event, input) => guard(() => appRuntime.icons(parse(iconsSchema, input))))
  ipcMain.handle('assets.status', () => guard(() => ({
    downloadsEnabled: !appRuntime.offline && appRuntime.bootstrap().imageDownloads === 'auto',
    pinnedVersion: readPin(path.join(process.cwd(), 'docs', 'assets-verification.json')),
    ready: 0,
    failed: 0
  })))
  ipcMain.handle('export.pull', () => exportSnapshot)
  ipcMain.handle('export.png', (_event, input) => guard(async () => {
    const body = parse(exportSchema, input)
    const hooks = process.env.ARAM_WRAPPED_TEST_HOOKS === '1'
    const result = await runExport({
      freeze: () => {
        exportSnapshot = appRuntime.exportSnapshot(body)
      },
      choosePath: async () => {
        if (hooks && process.env.ARAM_WRAPPED_EXPORT_CANCEL === '1') return null
        if (hooks && process.env.ARAM_WRAPPED_EXPORT_PATH) return process.env.ARAM_WRAPPED_EXPORT_PATH
        const picked = await dialog.showSaveDialog({
          title: 'Export PNG',
          defaultPath: 'aram-mayhem-wrapped.png',
          filters: [{ name: 'PNG', extensions: ['png'] }]
        })
        return picked.canceled || !picked.filePath ? null : picked.filePath
      },
      render: async () => {
        const snapshot = exportSnapshot
        if (!snapshot) throw new Error('missing-snapshot')
        return captureExport(snapshot)
      }
    })
    if (!result.ok) {
      if (result.code === 'disk_full') throw Object.assign(new Error('disk-full'), { code: 'disk_full' })
      if (result.canceled) return { path: null, canceled: true }
      throw Object.assign(new Error('export-failed'), { code: 'export_failed' })
    }
    if (hooks) await fs.promises.writeFile(`${result.path}.json`, JSON.stringify(exportSnapshot))
    return { path: result.path, canceled: false }
  }))
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!gotLock) return
  runtime = await AppRuntime.open()
  const active = runtime
  protocol.handle('wrapped-asset', (request) => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '')
    const root = path.resolve(active.bootstrap().storagePath, '..', 'assets')
    const full = path.resolve(root, relative)
    const rootLower = root.toLowerCase()
    const fullLower = full.toLowerCase()
    if (fullLower !== rootLower && !fullLower.startsWith(rootLower + path.sep)) return new Response(null, { status: 403 })
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return new Response(null, { status: 404 })
    const bytes = fs.readFileSync(full)
    const type = imageMediaType(bytes) ?? 'application/octet-stream'
    return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } })
  })
  registerIpc()
  const boot = active.bootstrap()
  if (boot.mode === 'real' && !boot.offline && !boot.schemaBlocked && boot.discovery.state === 'found') {
    if (boot.activeAccountId) void active.startSync(boot.activeAccountId, 'launch').catch(() => undefined)
    else await active.connectAndSync().catch(() => undefined)
  }
  await createWindow()
})

app.on('before-quit', (event) => {
  if (quitting || !runtime) return
  event.preventDefault()
  quitting = true
  void runtime.shutdown().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})
