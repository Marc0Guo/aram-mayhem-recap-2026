import championNames from './champion-names.json'
import { formatLocalDate } from './time'
import type { Locale } from './types'
export interface ExtraGame {
  startUtc: number | null
  durationSeconds: number | null
  championId: number | null
  championDamage: number | null
  deaths?: number | null
  kills: number | null
  assists: number | null
  resultState: string
  pentaKills: number | null
  teamDamage: number | null
  teamKills: number | null
  extraStats: Record<string, unknown> | null
}
export interface RecapFactCard { key: string; label: string; value: string; detail: string; championId?: number | null }
export interface AramChallengeCard { id: string; name: string; hint: string; value: string }
export const PING_FIELDS = { missing: 'enemyMissingPings', danger: 'dangerPings', assist: 'assistMePings', onMyWay: 'onMyWayPings', hold: 'holdPings', allIn: 'allInPings' } as const
export function extraNumber(game: ExtraGame, key: string): number | null {
  const challenges = game.extraStats?.challenges
  const value = game.extraStats?.[key] ?? (challenges && typeof challenges === 'object' ? (challenges as Record<string,unknown>)[key] : undefined)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
export function buildRecapExtras(games: ExtraGame[], locale: Locale, timeZone: string) {
  const zh = locale === 'zh-CN'
  const f = (v: number | null, digits = 0) => v == null ? '—' : new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US', { maximumFractionDigits: digits }).format(v)
  const sum = (values: Array<number | null>) => { const good = values.filter((x): x is number => x != null); return good.length ? good.reduce((a,b)=>a+b,0) : null }
  const duration = (seconds: number | null) => seconds == null ? '—' : zh ? `${Math.floor(seconds/3600)}小时${Math.floor(seconds%3600/60)}分${Math.floor(seconds%60)}秒` : `${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${Math.floor(seconds%60)}s`
  const rate = (part: number | null, whole: number | null) => part == null || whole == null || whole <= 0 ? null : part / whole
  const counted = (test: (g: ExtraGame) => boolean | null) => { const eligible = games.filter(g=>test(g)!=null); return eligible.length ? eligible.filter(g=>test(g)).length : null }
  const bestMatch = (field: string) => [...games].filter(g=>extraNumber(g,field)!=null).sort((a,b)=>extraNumber(b,field)!-extraNumber(a,field)!)[0]
  const matchDetail = (g: ExtraGame | undefined, damage = false) => { if(!g)return ''; const names=g.championId==null?null:(championNames as Record<string,{en:string;zh:string}>)[String(g.championId)]; const name=names?(zh?names.zh:names.en):''; const kda=g.kills!=null&&g.deaths!=null&&g.assists!=null?`${g.kills} / ${g.deaths} / ${g.assists}`:''; const parts=[name?`${zh?'使用':'As'} ${name}`:'',kda?`${zh?'战绩':'ending'} ${kda}`:'',damage&&g.championDamage!=null?`${f(g.championDamage)} ${zh?'伤害':'damage'}`:'',g.durationSeconds!=null?`${Math.floor(g.durationSeconds/60)}${zh?'分':'m '}${Math.floor(g.durationSeconds%60)}${zh?'秒':'s'}`:''];return parts.filter(Boolean).join(' · ') }
  const maxChampion = (field: string) => [...games].filter(g=>extraNumber(g,field)!=null).sort((a,b)=>extraNumber(b,field)!-extraNumber(a,field)!)[0]?.championId
  const max = (field: string) => { const values=games.map(g=>extraNumber(g,field)).filter((x):x is number=>x!=null); return values.length ? Math.max(...values) : null }
  const days = new Set(games.filter(g=>g.startUtc!=null).map(g=>formatLocalDate(g.startUtc!,timeZone))).size
  const totalTime=sum(games.map(g=>g.durationSeconds))
  const damageGames=games.filter(g=>g.championDamage!=null)
  const totalDamage=sum(damageGames.map(g=>g.championDamage))
  const shares=games.map(g=>({g,share:rate(g.championDamage,g.teamDamage)})).filter((x):x is {g:ExtraGame;share:number}=>x.share!=null&&x.share<=1).sort((a,b)=>b.share-a.share)
  const hits=sum(games.map(g=>extraNumber(g,'snowballsHit'))), casts=sum(games.map(g=>extraNumber(g,'snowballsThrown')))
  const snowRate=rate(hits,casts)
  const pings=Object.fromEntries(Object.entries(PING_FIELDS).map(([key,field])=>[key,sum(games.map(g=>extraNumber(g,field)))])) as Record<keyof typeof PING_FIELDS,number|null>
  const funCards: RecapFactCard[] = [
    {key:'poro',label:zh?'魄罗爆炸':'PORO EXPLOSIONS',value:f(sum(games.map(g=>extraNumber(g,'poroExplosions')))),detail:''},
    {key:'snowball',label:zh?'雪球命中率':'SNOWBALL HIT RATE',value:snowRate==null?'—':`${(snowRate*100).toFixed(2)}%`,detail:snowRate==null?'':`${f(hits)} / ${f(casts)}`},
    {key:'fountain',label:zh?'敌方泉水参与击杀':'TAKEDOWNS IN ENEMY FOUNTAIN',value:f(sum(games.map(g=>extraNumber(g,'takedownsInEnemyFountain')))),detail:''},
    {key:'dailyTime',label:zh?'日均游戏时长':'AVERAGE TIME SPENT PER DAY',value:duration(days>0&&totalTime!=null?totalTime/days:null),detail:days?`${days} ${zh?'个游戏日':'days played'} · ${duration(totalTime)}`:''},
    {key:'teamShare',label:zh?'最高队伍伤害占比':'HIGHEST DAMAGE PERCENT TEAM',value:shares.length?`${(shares[0].share*100).toFixed(2)}%`:'—',detail:shares.length?matchDetail(shares[0].g,true):'',championId:shares[0]?.g.championId},
    {key:'avgDamage',label:zh?'场均对英雄伤害':'AVERAGE DAMAGE DEALT PER GAME',value:f(totalDamage!=null&&damageGames.length?totalDamage/damageGames.length:null),detail:zh?`${f(totalDamage)} 总伤害 · ${damageGames.length} 场对局`:`${f(totalDamage)} total damage across ${damageGames.length} games`},
    {key:'healing',label:zh?'单局最高治疗量':'MOST HEALING IN ONE GAME',value:f(max('totalHeal')),detail:matchDetail(bestMatch('totalHeal')),championId:maxChampion('totalHeal')},
    {key:'mitigated',label:zh?'单局最高减伤量':'MOST DAMAGE MITIGATED',value:f(max('damageSelfMitigated')),detail:matchDetail(bestMatch('damageSelfMitigated')),championId:maxChampion('damageSelfMitigated')}
    ,{key:'gold',label:zh?'单局最多金币':'MOST GOLD EARNED',value:f(max('goldEarned')),detail:matchDetail(bestMatch('goldEarned')),championId:maxChampion('goldEarned')}
    ,{key:'cc',label:zh?'单局最长控制时长':'MOST TIME CROWD CONTROLLING',value:max('timeCCingOthers')==null?'—':`${f(max('timeCCingOthers'))} ${zh?'秒':'s'}`,detail:matchDetail(bestMatch('timeCCingOthers')),championId:maxChampion('timeCCingOthers')}
    ,{key:'turrets',label:zh?'单局最高防御塔伤害':'MOST DAMAGE TO TURRETS',value:f(max('damageDealtToTurrets')),detail:matchDetail(bestMatch('damageDealtToTurrets')),championId:maxChampion('damageDealtToTurrets')}
  ].filter(card=>card.value!=='—')
  const aramChallenges: AramChallengeCard[] = [
    ['101101',zh?'输出威胁':'DPS Threat',zh?'每分钟伤害超过 1800':'Deal more than 1,800 DPM',counted(g=>g.championDamage!=null&&g.durationSeconds?g.championDamage/(g.durationSeconds/60)>1800:null)],
    ['101102',zh?'双重毁灭':'Double Decimation',zh?'单局两次五杀':'Two pentakills in one game',counted(g=>g.pentaKills==null?null:g.pentaKills>=2)],
    ['101103',zh?'大乱斗传说':'ARAM Legend',zh?'达成超神':'Go Legendary',counted(g=>{const v=extraNumber(g,'largestKillingSpree');return v==null?null:v>=8})],
    ['101106',zh?'大乱斗清场':'ARAM Eradication',zh?'五杀次数':'Get pentakills',sum(games.map(g=>g.pentaKills))],
    ['101107',zh?'英雄才是补刀':'Farm Champs Not Minions',zh?'参与击杀':'Get takedowns',sum(games.map(g=>g.kills!=null&&g.assists!=null?g.kills+g.assists:null))],
    ['101108',zh?'孤胆英雄':'Solo Carry',zh?'承担队伍 40% 以上伤害':'Deal 40%+ of team champion damage',counted(g=>{const r=rate(g.championDamage,g.teamDamage);return r==null?null:r>=.4})],
    ['101203',zh?'下雪日':'Snow Day',zh?'雪球命中英雄':'Hit snowballs on champions',hits],
    ['101204',zh?'免费金币':'Free Money',zh?'击杀小兵':'Kill minions',sum(games.map(g=>extraNumber(g,'totalMinionsKilled')))],
    ['101201',zh?'百发百中':'Another Day Another Bullseye',zh?'技能命中英雄':'Hit skillshots on champions',sum(games.map(g=>extraNumber(g,'skillshotsHit')))],
    ['101202',zh?'差一点就中':'It Was a Near Hit',zh?'躲避技能':'Dodge skillshots',sum(games.map(g=>extraNumber(g,'skillshotsDodged')))],
    ['101304',zh?'闪电战':'Lightning Round',zh?'13 分钟内获胜':'Win before 13 minutes',counted(g=>g.durationSeconds==null?null:g.resultState==='win'&&g.durationSeconds<780)],
    ['101307',zh?'大乱斗常胜军':'NA-RAM',zh?'获得胜利':'Win games',counted(g=>g.resultState==='win'||g.resultState==='loss'?g.resultState==='win':null)]
  ].map(([id,name,hint,value])=>({id:String(id),name:String(name),hint:String(hint),value:f(value as number|null)}))
  return {pings,funCards,aramChallenges:aramChallenges.filter(card=>card.value!=='—')}
}
