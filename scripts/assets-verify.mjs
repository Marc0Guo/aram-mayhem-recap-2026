import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const outFile = path.join('docs', 'assets-verification.json')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function pngSize(bytes) {
  const buffer = Buffer.from(bytes)
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a' || buffer.length < 24) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  if (response.status >= 300 && response.status < 400) throw new Error(`redirect:${response.status}`)
  if (!response.ok) throw new Error(`http:${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('too-large')
  return { type, bytes, url }
}

function write(report, code) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = code
}

const report = {
  checkedAt: new Date().toISOString(),
  demoOnly: true,
  releaseGate: {
    passed: false,
    reason: 'No sanitized Mayhem fixture exists, so an augment observed in a real match was not verified.'
  },
  dataDragon: null,
  communityDragon: null,
  errors: []
}

try {
  const versions = await fetchBytes('https://ddragon.leagueoflegends.com/api/versions.json')
  const list = JSON.parse(Buffer.from(versions.bytes).toString('utf8'))
  const version = list.find((item) => /^\d+\.\d+\.\d+$/.test(item))
  if (!version) throw new Error('no-pinned-version')
  const championMeta = await fetchBytes(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
  const itemMeta = await fetchBytes(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`)
  const champions = JSON.parse(Buffer.from(championMeta.bytes).toString('utf8')).data
  const items = JSON.parse(Buffer.from(itemMeta.bytes).toString('utf8')).data
  const yasuo = Object.values(champions).find((champion) => champion.key === '157')
  const item = items['3031']
  if (!yasuo?.image?.full || !item?.image?.full) throw new Error('metadata-shape')
  const championUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${yasuo.image.full}`
  const itemUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${item.image.full}`
  const championImage = await fetchBytes(championUrl)
  const itemImage = await fetchBytes(itemUrl)
  const championDimensions = pngSize(championImage.bytes)
  const itemDimensions = pngSize(itemImage.bytes)
  if (!championImage.type.includes('image') || !championDimensions) throw new Error('champion-image')
  if (!itemImage.type.includes('image') || !itemDimensions) throw new Error('item-image')
  report.dataDragon = {
    version,
    locale: 'en_US',
    exampleNotFromMayhemFixture: true,
    champion: { id: '157', name: yasuo.name, url: championUrl, sha256: sha256(championImage.bytes), contentType: championImage.type, ...championDimensions },
    item: { id: '3031', name: item.name, url: itemUrl, sha256: sha256(itemImage.bytes), contentType: itemImage.type, ...itemDimensions }
  }
  const queues = await fetchBytes('https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/queues.json')
  const queueJson = JSON.parse(Buffer.from(queues.bytes).toString('utf8'))
  report.communityDragon = {
    metadataReachable: Array.isArray(queueJson) || typeof queueJson === 'object',
    pinnedPatch: null,
    note: 'latest was used only to confirm metadata is reachable. No image URL was pinned from latest, and no Mayhem augment was resolved.'
  }
  write(report, 2)
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : 'failed')
  write(report, 1)
}
