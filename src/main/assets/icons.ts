import fs from 'node:fs'
import path from 'node:path'
import {
  assertPublicAssetUrl,
  championPortraitUrl,
  communityDragonFromClientPath,
  communityDragonLocaleFile,
  communityDragonPatch,
  dataDragonDataUrl,
  dataDragonImageUrl,
  dataDragonSplashUrl,
  imageMediaType
} from '@shared/asset-urls'
import type { IconCatalog } from '@shared/bridge'
import type { Locale } from '@shared/types'
import { AssetCache } from './cache'

export type { IconCatalog }

export interface IconQuery {
  profileIconIds?: number[]
  locale: Locale
  championIds: number[]
  itemIds: number[]
  augmentIds: string[]
}

export type AssetFetch = (input: string, init?: { redirect?: 'manual'; signal?: AbortSignal }) => Promise<Response>

const EMPTY: IconCatalog = { champions: {}, items: {}, augments: {} }
const WEEK = 7 * 24 * 60 * 60 * 1000

interface ChampionMeta {
  key: string
  name: string
  file: string
  tags: string[]
}

interface ItemMeta {
  name: string
  file: string
}

interface AugmentMeta {
  rarity: 'silver' | 'gold' | 'prismatic' | 'unknown'
  name: string
  clientPath: string | null
}

interface Pin {
  dataDragon: string
  communityDragon: string
}

export async function resolveGameIcons(input: {
  directory: string
  query: IconQuery
  downloads: boolean
  fetchImpl?: AssetFetch
}): Promise<IconCatalog> {
  const fetchImpl = input.fetchImpl ?? fetch
  const profileIconIds = [...new Set((input.query.profileIconIds ?? []).filter(id => Number.isInteger(id) && id >= 0))]
  const championIds = uniqueNumbers(input.query.championIds)
  const itemIds = uniqueNumbers(input.query.itemIds)
  const augmentIds = uniqueStrings(input.query.augmentIds)
  if (profileIconIds.length === 0 && championIds.length === 0 && itemIds.length === 0 && augmentIds.length === 0) return EMPTY
  fs.mkdirSync(input.directory, { recursive: true })
  const pin = await loadPin(input.directory, input.downloads, fetchImpl)
  if (!pin) return EMPTY
  const locale = input.query.locale
  const [champions, items, augments] = await Promise.all([
    loadChampions(input.directory, pin, locale, input.downloads, fetchImpl),
    loadItems(input.directory, pin, locale, input.downloads, fetchImpl),
    loadAugments(input.directory, pin, locale, input.downloads, fetchImpl)
  ])
  const cache = new AssetCache(input.directory)
  const catalog: IconCatalog = { champions: {}, items: {}, augments: {} }
  await pool(championIds, 4, async (id) => {
    const meta = champions.get(id)
    if (!meta) return
    const portrait = await cachedImage(cache, input.directory, input.downloads, fetchImpl, ['cdragon', pin.communityDragon, 'shared', 'champion-portrait', String(id)], championPortraitUrl(pin.communityDragon, id))
      ?? await cachedImage(cache, input.directory, input.downloads, fetchImpl, ['ddragon', pin.dataDragon, 'shared', 'champion-square', String(id)], dataDragonImageUrl(pin.dataDragon, 'champion', meta.file))
    const splash = await cachedImage(cache, input.directory, input.downloads, fetchImpl, ['ddragon', pin.dataDragon, 'shared', 'champion-splash', String(id)], dataDragonSplashUrl(meta.key))
    catalog.champions[String(id)] = { name: meta.name, portrait: portrait ?? splash, splash, tags: meta.tags }
  })
  await pool(itemIds, 4, async (id) => {
    const meta = items.get(id)
    if (!meta) return
    const icon = await cachedImage(cache, input.directory, input.downloads, fetchImpl, ['ddragon', pin.dataDragon, 'shared', 'item', String(id)], dataDragonImageUrl(pin.dataDragon, 'item', meta.file))
    catalog.items[String(id)] = { name: meta.name, icon }
  })
  await pool(augmentIds, 4, async (id) => {
    const numeric = /^\d+$/.test(id) ? Number(id) : NaN
    const meta = Number.isInteger(numeric) ? augments.get(numeric) : undefined
    if (!meta) return
    const remote = meta.clientPath ? communityDragonFromClientPath(pin.communityDragon, meta.clientPath) : null
    const icon = remote
      ? await cachedImage(cache, input.directory, input.downloads, fetchImpl, ['cdragon', pin.communityDragon, 'shared', 'augment', id], remote)
      : null
    catalog.augments[id] = { name: meta.name, icon, rarity: meta.rarity }
  })
  if (profileIconIds.length) {
    catalog.profileIcons = {}
    await pool(profileIconIds, 4, async (id) => { const icon = await cachedImage(cache, input.directory, input.downloads, fetchImpl, ['cdragon', pin.communityDragon, 'shared', 'profile-icon', String(id)], `https://raw.communitydragon.org/${pin.communityDragon}/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`); catalog.profileIcons![String(id)] = icon })
  }
  return catalog
}

async function loadPin(directory: string, downloads: boolean, fetchImpl: AssetFetch): Promise<Pin | null> {
  const file = path.join(directory, 'meta', 'pin.json')
  const cached = readFreshJson(file, WEEK)
  const parsed = pinFrom(cached)
  if (parsed) return parsed
  if (!downloads) return null
  try {
    const bytes = await downloadBytes('https://ddragon.leagueoflegends.com/api/versions.json', fetchImpl, 1024 * 1024, 'json')
    const version = firstVersion(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
    if (!version) return null
    const pin = { dataDragon: version, communityDragon: communityDragonPatch(version) }
    writeJson(file, pin)
    return pin
  } catch {
    return null
  }
}

async function loadChampions(directory: string, pin: Pin, locale: Locale, downloads: boolean, fetchImpl: AssetFetch): Promise<Map<number, ChampionMeta>> {
  const folder = locale === 'zh-CN' ? 'zh_CN' : 'en_US'
  const file = path.join(directory, 'meta', `champions-${pin.dataDragon}-${folder}.json`)
  const payload = await readOrFetch(file, dataDragonDataUrl(pin.dataDragon, folder, 'champion.json'), downloads, fetchImpl)
  return parseChampions(payload)
}

async function loadItems(directory: string, pin: Pin, locale: Locale, downloads: boolean, fetchImpl: AssetFetch): Promise<Map<number, ItemMeta>> {
  const folder = locale === 'zh-CN' ? 'zh_CN' : 'en_US'
  const file = path.join(directory, 'meta', `items-${pin.dataDragon}-${folder}.json`)
  const payload = await readOrFetch(file, dataDragonDataUrl(pin.dataDragon, folder, 'item.json'), downloads, fetchImpl)
  return parseItems(payload)
}

async function loadAugments(directory: string, pin: Pin, locale: Locale, downloads: boolean, fetchImpl: AssetFetch): Promise<Map<number, AugmentMeta>> {
  const folder = locale === 'zh-CN' ? 'zh_cn' : 'default'
  const file = path.join(directory, 'meta', `augments-${pin.communityDragon}-${folder}.json`)
  const payload = await readOrFetch(file, communityDragonLocaleFile(pin.communityDragon, folder, 'cherry-augments.json'), downloads, fetchImpl)
  const parsed = parseAugments(payload)
  if (parsed.size > 0 || folder === 'default') return parsed
  const fallback = path.join(directory, 'meta', `augments-${pin.communityDragon}-default.json`)
  const english = await readOrFetch(fallback, communityDragonLocaleFile(pin.communityDragon, 'default', 'cherry-augments.json'), downloads, fetchImpl)
  return parseAugments(english)
}

async function readOrFetch(file: string, url: string, downloads: boolean, fetchImpl: AssetFetch): Promise<unknown | null> {
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    } catch {
      fs.rmSync(file, { force: true })
    }
  }
  if (!downloads) return null
  try {
    const bytes = await downloadBytes(url, fetchImpl, 12 * 1024 * 1024, 'json')
    const text = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(text) as unknown
    writeJson(file, parsed)
    return parsed
  } catch {
    return null
  }
}

async function cachedImage(cache: AssetCache, directory: string, downloads: boolean, fetchImpl: AssetFetch, parts: string[], url: string): Promise<string | null> {
  const existing = findCached(directory, parts)
  if (existing) return wrappedAssetUrl(existing)
  if (!downloads) return null
  try {
    const bytes = await downloadBytes(url, fetchImpl, 2 * 1024 * 1024, 'image')
    const relative = await cache.publish({
      provider: parts[0] ?? 'asset',
      version: parts[1] ?? '0',
      locale: parts[2] ?? 'shared',
      entityType: parts[3] ?? 'image',
      entityId: parts[4] ?? '0',
      sourceUrl: url,
      bytes
    })
    return wrappedAssetUrl(relative)
  } catch {
    return null
  }
}

async function downloadBytes(url: string, fetchImpl: AssetFetch, max: number, expect: 'json' | 'image'): Promise<Uint8Array> {
  const response = await fetchChecked(url, fetchImpl)
  if (!response.ok) throw new Error('asset-status')
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  if (type.includes('text/html')) throw new Error('asset-type')
  if (expect === 'json' && !type.includes('json') && !type.includes('text/plain')) throw new Error('asset-type')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > max) throw new Error('asset-size')
  if (expect === 'image' && !imageMediaType(bytes)) throw new Error('asset-type')
  if (expect === 'json') {
    const head = new TextDecoder().decode(bytes.subarray(0, 1))
    if (head !== '{' && head !== '[') throw new Error('asset-type')
  }
  return bytes
}

async function fetchChecked(url: string, fetchImpl: AssetFetch): Promise<Response> {
  const first = assertPublicAssetUrl(url)
  let response = await fetchImpl(first.toString(), { redirect: 'manual', signal: AbortSignal.timeout(20000) })
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) throw new Error('asset-redirect')
    const next = assertPublicAssetUrl(new URL(location, first).toString())
    response = await fetchImpl(next.toString(), { redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (response.status >= 300 && response.status < 400) throw new Error('asset-redirect')
  }
  return response
}

function parseChampions(payload: unknown): Map<number, ChampionMeta> {
  const map = new Map<number, ChampionMeta>()
  const data = record(payload)?.data
  if (!data || typeof data !== 'object') return map
  for (const value of Object.values(data as Record<string, unknown>)) {
    const row = record(value)
    if (!row) continue
    const key = typeof row.id === 'string' ? row.id : ''
    const numeric = typeof row.key === 'string' ? Number(row.key) : NaN
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const image = record(row.image)
    const file = typeof image?.full === 'string' ? image.full : ''
    if (!Number.isInteger(numeric) || numeric < 1 || !/^[A-Za-z0-9]+$/.test(key) || !name || !/^[A-Za-z0-9_.-]+$/.test(file)) continue
    const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => tag === 'Tank' || tag === 'Fighter' || tag === 'Assassin' || tag === 'Mage' || tag === 'Marksman' || tag === 'Support') : []
    map.set(numeric, { key, name, file, tags })
  }
  return map
}

function parseItems(payload: unknown): Map<number, ItemMeta> {
  const map = new Map<number, ItemMeta>()
  const data = record(payload)?.data
  if (!data || typeof data !== 'object') return map
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const id = Number(key)
    const row = record(value)
    if (!row || !Number.isInteger(id) || id < 1) continue
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const image = record(row.image)
    const file = typeof image?.full === 'string' ? image.full : `${id}.png`
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(file)) continue
    map.set(id, { name, file })
  }
  return map
}

function parseAugments(payload: unknown): Map<number, AugmentMeta> {
  const map = new Map<number, AugmentMeta>()
  if (!Array.isArray(payload)) return map
  for (const value of payload) {
    const row = record(value)
    if (!row || typeof row.id !== 'number' || !Number.isInteger(row.id) || row.id <= 0) continue
    const named = typeof row.nameTRA === 'string' && row.nameTRA.trim() ? row.nameTRA.trim() : String(row.id)
    const icon = typeof row.augmentSmallIconPath === 'string' ? row.augmentSmallIconPath : null
    map.set(row.id, { rarity: row.rarity === 'kSilver' ? 'silver' : row.rarity === 'kGold' ? 'gold' : row.rarity === 'kPrismatic' ? 'prismatic' : 'unknown', name: named, clientPath: icon && icon.startsWith('/lol-game-data/assets/') ? icon : null })
  }
  return map
}

function pinFrom(payload: unknown): Pin | null {
  const row = record(payload)
  if (!row || typeof row.dataDragon !== 'string' || typeof row.communityDragon !== 'string') return null
  try {
    if (communityDragonPatch(row.dataDragon) !== row.communityDragon) return null
    return { dataDragon: row.dataDragon, communityDragon: row.communityDragon }
  } catch {
    return null
  }
}

function firstVersion(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null
  const version = payload.find((item) => typeof item === 'string' && /^\d+\.\d+\.\d+$/.test(item))
  return typeof version === 'string' ? version : null
}

function findCached(directory: string, parts: string[]): string | null {
  const folder = path.join(directory, ...parts)
  if (!fs.existsSync(folder)) return null
  const name = fs.readdirSync(folder).find((entry) => !entry.endsWith('.partial'))
  if (!name) return null
  return [...parts, name].join('/')
}

function wrappedAssetUrl(relative: string): string {
  if (!relative || relative.includes('..') || relative.startsWith('/') || relative.includes('\\')) throw new Error('bad-asset-file')
  return `wrapped-asset://local/${relative.split('/').map((part) => encodeURIComponent(part)).join('/')}`
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.partial`
  fs.writeFileSync(temporary, JSON.stringify(value))
  fs.renameSync(temporary, file)
}

function readFreshJson(file: string, maxAge: number): unknown | null {
  if (!fs.existsSync(file)) return null
  if (Date.now() - fs.statSync(file).mtimeMs > maxAge) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))]
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

async function pool<T>(values: T[], limit: number, worker: (value: T) => Promise<void>): Promise<void> {
  if (values.length === 0) return
  let index = 0
  async function run(): Promise<void> {
    while (index < values.length) {
      const current = values[index]
      index += 1
      if (current !== undefined) await worker(current)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()))
}
