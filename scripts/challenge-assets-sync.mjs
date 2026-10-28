import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
const patch = '16.21'
const base = 'https://raw.communitydragon.org/' + patch + '/plugins/rcp-be-lol-game-data/global/default/'
const catalog = JSON.parse(await fs.readFile('src/shared/challenge-catalog.json','utf8'))
const metadataUrl = base + 'v1/challenges.json'
const response = await fetch(metadataUrl)
if (!response.ok) throw Error('Challenge metadata HTTP ' + response.status)
const {challenges} = await response.json()
const folder = 'src/renderer/src/assets/challenges'
await fs.mkdir(folder,{recursive:true})
const metadataChallengeIds = Object.entries(challenges).filter(([id,row]) => /^101\d{3}$/.test(id) && row.tags?.isCapstone !== 'Y').map(([id]) => id).sort()
const jobs = Object.keys(catalog).flatMap(id => {
  const row = challenges[id]
  if (!row?.levelToIconPath) throw Error('Missing challenge metadata: ' + id)
  return Object.entries(row.levelToIconPath).map(([level, clientPath]) => {
    if (!/^(IRON|BRONZE|SILVER|GOLD|PLATINUM|DIAMOND|MASTER|GRANDMASTER|CHALLENGER)$/.test(level)) throw Error('Unknown tier')
    const prefix = '/lol-game-data/assets/'
    if (!clientPath.startsWith(prefix)) throw Error('Unexpected client asset path')
    return {id,level,url:base + clientPath.slice(prefix.length).toLowerCase(),file:folder+'/'+id+'-'+level.toLowerCase()+'.png'}
  })
})
const manifest = []
let index = 0
await Promise.all(Array.from({length:6},async () => {
  while(index < jobs.length) {
    const job = jobs[index++]
    const res = await fetch(job.url)
    if (!res.ok) throw Error(job.id + ' ' + job.level + ' HTTP ' + res.status)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw Error('Invalid PNG: '+job.url)
    await fs.writeFile(job.file, bytes)
    manifest.push({...job,bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')})
  }
}))
manifest.sort((a,b)=>a.id.localeCompare(b.id)||a.level.localeCompare(b.level))
await fs.writeFile('docs/challenge-tier-assets.json',JSON.stringify({patch,metadataUrl,metadataChallengeIds,assets:manifest},null,2)+'\n')
console.log(JSON.stringify({challenges:Object.keys(catalog).length,icons:manifest.length,bytes:manifest.reduce((n,x)=>n+x.bytes,0)}))
