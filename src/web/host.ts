import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { ZodError } from 'zod'
import { imageMediaType } from '@shared/asset-urls'
import type { ApiResult, IconCatalog, SyncView } from '@shared/bridge'
import {
  deleteAccountSchema,
  detailSchema,
  iconsSchema,
  listSchema,
  rangeSchema,
  settingsSchema,
  syncCancelSchema,
  syncStartSchema
} from '@shared/schemas'
import { AppRuntime } from '../main/runtime'

interface ProgressEvent {
  seq: number
  progress: SyncView
}

export interface WebHost {
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
  close(): Promise<void>
}

export async function createHost(): Promise<WebHost> {
  const runtime = await AppRuntime.open()
  const events: ProgressEvent[] = []
  let seq = 0
  runtime.onProgress((progress) => {
    seq += 1
    events.push({ seq, progress })
    if (events.length > 40) events.shift()
  })
  const boot = runtime.bootstrap()
  if (boot.mode === 'real' && !boot.offline && !boot.schemaBlocked && boot.discovery.state === 'found') {
    const start = boot.activeAccountId
      ? runtime.startSync(boot.activeAccountId, 'launch')
      : runtime.connectAndSync()
    void start.catch(() => undefined)
  }

  return {
    handle: (req, res) => route(runtime, events, req, res),
    close: () => runtime.shutdown()
  }
}

async function route(runtime: AppRuntime, events: ProgressEvent[], req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname.startsWith('/assets/')) {
    serveAsset(runtime, url, res)
    return true
  }
  if (!url.pathname.startsWith('/api/')) return false
  try {
    const body = req.method === 'GET' ? {} : await readBody(req)
    const data = await dispatch(runtime, events, url, body)
    send(res, 200, { ok: true, data })
  } catch (error) {
    send(res, 400, failure(error))
  }
  return true
}

async function dispatch(runtime: AppRuntime, events: ProgressEvent[], url: URL, body: unknown): Promise<unknown> {
  switch (url.pathname) {
    case '/api/bootstrap':
      return runtime.bootstrap()
    case '/api/events': {
      const after = Number(url.searchParams.get('after') ?? '0')
      const fresh = events.filter((event) => event.seq > after)
      return { events: fresh.map((event) => event.progress), cursor: fresh.at(-1)?.seq ?? after }
    }
    case '/api/assets':
      return {
        downloadsEnabled: !runtime.offline && runtime.bootstrap().imageDownloads === 'auto',
        pinnedVersion: pinnedVersion(),
        ready: 0,
        failed: 0
      }
    case '/api/dashboard':
      return runtime.dashboard(rangeSchema.parse(body))
    case '/api/matches':
      return runtime.matches(listSchema.parse(body))
    case '/api/detail': {
      const detail = runtime.detail(detailSchema.parse(body))
      if (!detail) throw Object.assign(new Error('not-found'), { code: 'not_found' })
      return detail
    }
    case '/api/icons':
      return rewriteCatalog(await runtime.icons(iconsSchema.parse(body)))
    case '/api/sync': {
      const parsed = syncStartSchema.parse(body)
      return runtime.startSync(parsed.accountId, parsed.kind)
    }
    case '/api/sync/cancel': {
      const parsed = syncCancelSchema.parse(body)
      await runtime.cancel(parsed.runId)
      return { runId: parsed.runId }
    }
    case '/api/connect':
      return runtime.connectAndSync()
    case '/api/demo':
      return runtime.useDemo()
    case '/api/real':
      return runtime.useReal()
    case '/api/discovery':
      return runtime.refreshDiscovery()
    case '/api/settings':
      return runtime.updateSettings(settingsSchema.parse(body))
    case '/api/delete': {
      const parsed = deleteAccountSchema.parse(body)
      return runtime.deleteAccount(parsed.accountId)
    }
    case '/api/open-league':
      return openLeague(runtime)
    case '/api/location':
      return openLocation(runtime, body)
    default:
      throw Object.assign(new Error('not-found'), { code: 'not_found' })
  }
}

function openLeague(runtime: AppRuntime): { message: string } {
  const opened = runtime.openLeague()
  if (!opened.ok) return { message: opened.message }
  const child = spawn(opened.message, [], { detached: true, stdio: 'ignore' })
  child.unref()
  return { message: 'opening' }
}

function openLocation(runtime: AppRuntime, body: unknown): { opened: boolean } {
  const kind = typeof body === 'object' && body && 'kind' in body ? body.kind : ''
  const boot = runtime.bootstrap()
  const target = kind === 'logs' ? boot.logPath : kind === 'data' ? boot.storagePath : ''
  if (!target) return { opened: false }
  const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' })
  child.unref()
  return { opened: true }
}

function rewriteCatalog(catalog: IconCatalog): IconCatalog {
  const champions: IconCatalog['champions'] = {}
  const items: IconCatalog['items'] = {}
  const augments: IconCatalog['augments'] = {}
  for (const [id, face] of Object.entries(catalog.champions)) {
    champions[id] = { ...face, portrait: localAsset(face.portrait), splash: localAsset(face.splash) }
  }
  for (const [id, tile] of Object.entries(catalog.items)) items[id] = { ...tile, icon: localAsset(tile.icon) }
  for (const [id, tile] of Object.entries(catalog.augments)) augments[id] = { ...tile, icon: localAsset(tile.icon) }
  const profileIcons = catalog.profileIcons ? Object.fromEntries(Object.entries(catalog.profileIcons).map(([id, url]) => [id, localAsset(url)])) : undefined
  return { champions, items, augments, profileIcons }
}

function localAsset(value: string | null): string | null {
  const marker = 'wrapped-asset://local/'
  if (!value?.startsWith(marker)) return null
  const rest = value.slice(marker.length)
  if (!/^[A-Za-z0-9%._/-]+$/.test(rest)) return null
  return `/assets/${rest}`
}

function serveAsset(runtime: AppRuntime, url: URL, res: ServerResponse): void {
  let relative = ''
  try {
    relative = decodeURIComponent(url.pathname.slice('/assets/'.length))
  } catch {
    res.writeHead(400).end()
    return
  }
  if (relative.includes('\0') || relative.split(/[/\\]/).includes('..')) {
    res.writeHead(403).end()
    return
  }
  const root = path.resolve(runtime.bootstrap().storagePath, '..', 'assets')
  const full = path.resolve(root, relative)
  const rootLower = root.toLowerCase()
  const fullLower = full.toLowerCase()
  if (fullLower !== rootLower && !fullLower.startsWith(`${rootLower}${path.sep}`)) {
    res.writeHead(403).end()
    return
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404).end()
    return
  }
  const bytes = fs.readFileSync(full)
  if (bytes.length > 12_000_000) {
    res.writeHead(404).end()
    return
  }
  const type = imageMediaType(bytes) ?? (path.extname(full).toLowerCase() === '.json' ? 'application/json' : null)
  if (!type) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400', 'content-length': bytes.length })
  res.end(bytes)
}

function pinnedVersion(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'assets-verification.json'), 'utf8')) as { dataDragon?: { version?: string } }
    return typeof raw.dataDragon?.version === 'string' ? raw.dataDragon.version : null
  } catch {
    return null
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(Object.assign(new Error('too-large'), { code: 'validation' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('invalid'), { code: 'validation' }))
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function failure(error: unknown): ApiResult<never> {
  const code = error instanceof ZodError
    ? 'validation'
    : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'request_failed'
  return { ok: false, error: { code, message: code, retryable: false, correlationId: 'web' } }
}
