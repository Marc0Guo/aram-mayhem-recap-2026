import { describe, expect, it } from 'vitest'
import { buildRecapExtras, type ExtraGame } from '../src/shared/recap-extras'
const game = (patch: Partial<ExtraGame>): ExtraGame => ({startUtc: Date.UTC(2026,0,1,12),durationSeconds:1200,championId:1,championDamage:20000,kills:5,assists:10,resultState:'win',pentaKills:0,teamDamage:50000,teamKills:20,extraStats:{},...patch})
describe('ARAM recap extras',()=>{
  it('uses known fields and correct active-day and team denominators',()=>{
    const value=buildRecapExtras([game({deaths:2,extraStats:{enemyMissingPings:3,totalHeal:2000,damageSelfMitigated:10000,largestKillingSpree:8}}),game({championId:2,deaths:8,durationSeconds:600,championDamage:10000,teamDamage:30000,pentaKills:2,extraStats:{enemyMissingPings:2,totalHeal:5000,damageSelfMitigated:9000}})],'en','UTC')
    expect(value.pings.missing).toBe(5);expect(value.pings.allIn).toBeNull()
    const cards=Object.fromEntries(value.funCards.map(c=>[c.key,c]))
    expect(cards.dailyTime.value).toBe('0h 30m 0s');expect(cards.avgDamage.value).toBe('15,000');expect(cards.teamShare.value).toBe('40.00%');expect(cards.healing.value).toBe('5,000');expect(cards.healing.detail).toBe('As Olaf · ending 5 / 8 / 10 · 10m 0s');expect(cards.healing.championId).toBe(2);expect(cards.teamShare.detail).toContain('As Annie · ending 5 / 2 / 10');expect(cards.poro).toBeUndefined();expect(cards.snowball).toBeUndefined()
    expect(value.aramChallenges.find(c=>c.id==='101102')?.value).toBe('1');expect(value.aramChallenges.find(c=>c.id==='101304')?.value).toBe('1');expect(value.aramChallenges.every(c=>c.value!=='—')).toBe(true)
  })
  it('does not turn unavailable stats into zeros or infer snowball hits',()=>{
    const value=buildRecapExtras([game({teamDamage:null,extraStats:{playerScore0:500,spell2Casts:50}})],'zh-CN','UTC')
    expect(value.funCards.some(c=>c.key==='teamShare')).toBe(false);expect(value.funCards.some(c=>c.key==='snowball')).toBe(false);expect(Object.values(value.pings).every(v=>v===null)).toBe(true)
  })
})
