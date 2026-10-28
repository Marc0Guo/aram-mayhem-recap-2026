import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import catalog from '../src/shared/challenge-catalog.json'
import manifest from '../docs/challenge-tier-assets.json'

const tiers = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','MASTER','GRANDMASTER','CHALLENGER']
describe('bundled ARAM challenge icons', () => {
  it('covers every supported challenge at every attainable tier', () => {
    expect(Object.keys(catalog).sort()).toEqual(manifest.metadataChallengeIds)
    for (const id of Object.keys(catalog)) for (const tier of tiers) {
      expect(manifest.assets.some(asset => asset.id === id && asset.level === tier), id + ' ' + tier).toBe(true)
    }
    expect(manifest.assets).toHaveLength(Object.keys(catalog).length * tiers.length)
  })
  it('contains real PNG files matching the verified pinned asset manifest', () => {
    for (const asset of manifest.assets) {
      const bytes = fs.readFileSync(path.resolve(asset.file))
      expect(bytes.subarray(0,8).toString('hex'), asset.file).toBe('89504e470d0a1a0a')
      expect(bytes.readUInt32BE(16)).toBeGreaterThan(0)
      expect(bytes.readUInt32BE(20)).toBeGreaterThan(0)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
      expect(asset.url).toContain('https://raw.communitydragon.org/16.21/')
      expect(asset.file.endsWith(asset.id + '-' + asset.level.toLowerCase() + '.png')).toBe(true)
    }
  })
})
