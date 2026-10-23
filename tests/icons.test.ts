import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { championPortraitUrl, communityDragonFromClientPath, communityDragonPatch, dataDragonSplashUrl } from '../src/shared/asset-urls'
import { resolveGameIcons, type AssetFetch } from '../src/main/assets/icons'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('game icons', () => {
  it('pins a patch and keeps the client asset extension', () => {
    expect(communityDragonPatch('16.21.1')).toBe('16.21')
    expect(dataDragonSplashUrl('Brand')).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Brand_0.jpg')
    expect(championPortraitUrl('16.21', 63)).toContain('/v1/champion-icons/63.png')
    expect(communityDragonFromClientPath('16.21', '/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/UpgradeIE_small.png')).toBe(
      'https://raw.communitydragon.org/16.21/plugins/rcp-be-lol-game-data/global/default/assets/ux/kiwi/augments/icons/upgradeie_small.png'
    )
    expect(() => communityDragonPatch('latest')).toThrow('unpinned-asset-version')
  })

  it('caches champion, item, and augment images without using an unpinned host', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-icons-'))
    directories.push(directory)
    const calls: string[] = []
    const catalog = await resolveGameIcons({
      directory,
      downloads: true,
      query: { locale: 'zh-CN', championIds: [63], itemIds: [3031], augmentIds: ['1092'] },
      fetchImpl: mockFetch(calls)
    })
    expect(catalog.champions['63']?.name).toBe('布兰德')
    expect(catalog.champions['63']?.tags).toEqual(['Mage'])
    expect(catalog.champions['63']?.portrait).toMatch(/^wrapped-asset:\/\/local\//)
    expect(catalog.champions['63']?.splash).toMatch(/^wrapped-asset:\/\/local\//)
    expect(catalog.items['3031']).toEqual({ name: '无尽之刃', icon: expect.stringMatching(/^wrapped-asset:\/\/local\//) })
    expect(catalog.augments['1092']?.name).toBe('易损')
    expect(catalog.augments['1092']?.rarity).toBe('gold')
    expect(catalog.augments['1092']?.icon).toMatch(/augment/)
    expect(calls.some((url) => url.includes('/latest/'))).toBe(false)
    expect(calls.some((url) => url.includes('evil.example'))).toBe(false)
    const again: string[] = []
    const cached = await resolveGameIcons({
      directory,
      downloads: true,
      query: { locale: 'zh-CN', championIds: [63], itemIds: [3031], augmentIds: ['1092'] },
      fetchImpl: mockFetch(again)
    })
    expect(cached.champions['63']?.portrait).toBe(catalog.champions['63']?.portrait)
    expect(again).toEqual([])
  })

  it('does not download when image downloads are off', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-icons-'))
    directories.push(directory)
    const calls: string[] = []
    const catalog = await resolveGameIcons({
      directory,
      downloads: false,
      query: { locale: 'en', championIds: [63], itemIds: [3031], augmentIds: ['1092'] },
      fetchImpl: mockFetch(calls)
    })
    expect(catalog).toEqual({ champions: {}, items: {}, augments: {} })
    expect(calls).toEqual([])
  })

  it('rejects a redirect off the asset hosts', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-icons-'))
    directories.push(directory)
    const fetchImpl: AssetFetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/api/versions.json')) {
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/versions.json' } })
      }
      throw new Error(`unexpected ${url}`)
    }
    const catalog = await resolveGameIcons({
      directory,
      downloads: true,
      query: { locale: 'zh-CN', championIds: [63], itemIds: [], augmentIds: [] },
      fetchImpl
    })
    expect(catalog.champions).toEqual({})
  })
})

function mockFetch(calls: string[]): AssetFetch {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  png[16] = 0
  png[17] = 0
  png[18] = 0
  png[19] = 1
  png[20] = 0
  png[21] = 0
  png[22] = 0
  png[23] = 1
  return async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/api/versions.json')) return json(['16.21.1'])
    if (url.endsWith('/champion.json')) {
      return json({ data: { Brand: { id: 'Brand', key: '63', name: '布兰德', tags: ['Mage'], image: { full: 'Brand.png' } } } })
    }
    if (url.endsWith('/item.json')) {
      return json({ data: { '3031': { name: '无尽之刃', image: { full: '3031.png' } } } })
    }
    if (url.endsWith('/cherry-augments.json')) {
      return json([{ id: 1092, nameTRA: '易损', rarity: 'kGold', augmentSmallIconPath: '/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Vulnerability_small.png' }])
    }
    if (url.includes('/latest/') || url.includes('evil.example')) return new Response('no', { status: 500 })
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
  }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}
