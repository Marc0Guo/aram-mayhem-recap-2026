import type { OwnedChallenge } from './types'
const LEVELS = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','MASTER','GRANDMASTER','CHALLENGER']
export function readOwnedChallenges(payload: unknown): OwnedChallenge[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('challenge-schema')
  return Object.entries(payload).flatMap(([id, value]) => {
    if (!/^101\d{3}$/.test(id) || !value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    if (row.isCapstone === true || !Array.isArray(row.gameModes) || !row.gameModes.includes('ARAM') || !LEVELS.includes(String(row.currentLevel)) || typeof row.currentValue !== 'number' || !Number.isFinite(row.currentValue) || row.currentValue <= 0) return []
    return [{id,name:typeof row.name==='string'?row.name:'',description:typeof row.descriptionShort==='string'?row.descriptionShort:'',level:String(row.currentLevel),value:row.currentValue,percentile:typeof row.percentile==='number'&&Number.isFinite(row.percentile)&&row.percentile>=0&&row.percentile<=100?row.percentile:null,rank:typeof row.position==='number'&&Number.isSafeInteger(row.position)&&row.position>0?row.position:null}]
  }).sort((a,b)=>(a.percentile??Infinity)-(b.percentile??Infinity)||LEVELS.indexOf(b.level)-LEVELS.indexOf(a.level)||a.id.localeCompare(b.id))
}
