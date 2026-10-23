export const DATA_DRAGON_HOST = 'ddragon.leagueoflegends.com'
export const COMMUNITY_DRAGON_HOST = 'raw.communitydragon.org'
export const ALLOWED_ASSET_HOSTS = new Set([DATA_DRAGON_HOST, COMMUNITY_DRAGON_HOST])

const CLIENT_ASSET_PREFIX = '/lol-game-data/assets/'

export function assertPinnedVersion(version: string): string {
  if (!version || version === 'latest' || version.includes('..') || version.includes('/') || version.includes('\\')) {
    throw new Error('unpinned-asset-version')
  }
  return version
}

export function dataDragonDataUrl(version: string, locale: 'en_US' | 'zh_CN', file: 'champion.json' | 'item.json'): string {
  const pin = assertPinnedVersion(version)
  return `https://ddragon.leagueoflegends.com/cdn/${pin}/data/${locale}/${file}`
}

export function dataDragonImageUrl(version: string, kind: 'champion' | 'item', file: string): string {
  const pin = assertPinnedVersion(version)
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
    throw new Error('bad-asset-file')
  }
  return `https://ddragon.leagueoflegends.com/cdn/${pin}/img/${kind}/${file}`
}

export function dataDragonSplashUrl(championKey: string): string {
  if (!/^[A-Za-z0-9]+$/.test(championKey)) throw new Error('bad-asset-file')
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championKey}_0.jpg`
}

export function communityDragonPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(assertPinnedVersion(version))
  if (!match) throw new Error('unpinned-asset-version')
  return `${match[1]}.${match[2]}`
}

export function championPortraitUrl(patch: string, championId: number): string {
  const pin = assertPinnedVersion(patch)
  if (!Number.isInteger(championId) || championId < 1 || championId > 9999) throw new Error('bad-asset-file')
  return `https://raw.communitydragon.org/${pin}/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`
}

export function communityDragonLocaleFile(patch: string, locale: 'zh_cn' | 'default', file: 'cherry-augments.json'): string {
  const pin = assertPinnedVersion(patch)
  return `https://raw.communitydragon.org/${pin}/plugins/rcp-be-lol-game-data/global/${locale}/v1/${file}`
}

export function communityDragonFromClientPath(patch: string, clientPath: string): string | null {
  if (!clientPath.startsWith(CLIENT_ASSET_PREFIX)) return null
  const pin = assertPinnedVersion(patch)
  const rest = clientPath.slice(CLIENT_ASSET_PREFIX.length).toLowerCase()
  if (rest.startsWith('/') || rest.includes('..')) return null
  return `https://raw.communitydragon.org/${pin}/plugins/rcp-be-lol-game-data/global/default/${rest}`
}

export function communityDragonFileUrl(patch: string, file: string): string {
  const pin = assertPinnedVersion(patch)
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
    throw new Error('bad-asset-file')
  }
  return `https://raw.communitydragon.org/${pin}/plugins/rcp-be-lol-game-data/global/default/v1/${file}`
}

export function assertPublicAssetUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('asset-url-protocol')
  if (!ALLOWED_ASSET_HOSTS.has(url.hostname)) throw new Error('asset-url-host')
  if (url.username || url.password) throw new Error('asset-url-auth')
  if (url.hostname === COMMUNITY_DRAGON_HOST && url.pathname.includes('/latest/')) {
    throw new Error('asset-url-unpinned')
  }
  return url
}

export function readClientAssetPath(record: unknown): { field: string; path: string } | null {
  if (!record || typeof record !== 'object') return null
  const preferred = ['augmentSmallIconPath', 'iconPath', 'squarePortraitPath', 'iconSmall', 'icon']
  const obj = record as Record<string, unknown>
  for (const field of preferred) {
    const value = obj[field]
    if (typeof value === 'string' && value.startsWith(CLIENT_ASSET_PREFIX)) return { field, path: value }
  }
  return null
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

export function imageMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  return null
}

export function imageDimensions(bytes: Uint8Array, contentType: string): { width: number; height: number } | null {
  const type = contentType.toLowerCase()
  const view = viewOf(bytes)
  if (bytes.length >= 24 && ascii(bytes, 0, 8) === '\u0089PNG\r\n\u001a\n') {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1] ?? 0
      const size = view.getUint16(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      }
      if (size < 2) return null
      offset += 2 + size
    }
    return null
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    if (ascii(bytes, 12, 4) === 'VP8X') {
      const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16)
      const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16)
      return { width, height }
    }
  }
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(100, bytes.length)))
  if ((type.includes('svg') || head.includes('<svg')) && bytes.length > 20) {
    return { width: 64, height: 64 }
  }
  return null
}
