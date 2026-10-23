import { describe, expect, it } from 'vitest'
import { buildPosterFacts, readStoredGame } from '../src/shared/match-facts'
describe('reference recap summary',()=>{
  const game=(win:boolean)=>readStoredGame({startUtc:win?1:2,championId:1,resultState:win?'win':'loss',kills:null,deaths:null,assists:null,championDamage:null,durationSeconds:600,selfParticipantId:'1',raw:{participants:Array.from({length:10},(_,i)=>({participantId:i+1,teamId:i<5?100:200,championId:1,stats:{kills:i===0?(win?2:4):i<5?(win?1:3):(win?2:1),assists:i===0?(win?3:1):0,deaths:1,totalDamageDealtToChampions:100,pentaKills:0,quadraKills:0,tripleKills:1}}))}})
  it('uses complete team totals and chronological streaks',()=>{
    const summary=buildPosterFacts([game(false),game(true)],'en','Perfect').summary!
    expect(summary).toMatchObject({totalDamage:200,takedowns:10,winsFewerKills:1,lossesMoreKills:1,winStreak:1,lossStreak:1,triple:2})
    expect(summary.killParticipation).toBeCloseTo(10/22)
  })
  it('does not calculate participation from a partial team',()=>{
    const g=readStoredGame({championId:1,resultState:'win',kills:2,deaths:1,assists:3,championDamage:100,durationSeconds:600,selfParticipantId:'1',raw:{participants:[{participantId:1,teamId:100,stats:{kills:2}},{participantId:2,teamId:100,stats:{kills:1}}]}})
    expect(buildPosterFacts([g],'en','Perfect').summary?.killParticipation).toBeNull()
  })
})
