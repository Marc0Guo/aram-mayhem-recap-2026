import { describe, expect, it } from 'vitest'
import { parseLcuJson } from '../src/shared/ids'
import { readOwnedChallenges } from '../src/shared/owned-challenges'
describe('official owned ARAM challenges',()=>{
  const row=(patch:Record<string,unknown>)=>({name:'Challenge',descriptionShort:'Description',gameModes:['ARAM','KIWI'],currentLevel:'MASTER',currentValue:12,percentile:3,position:0,...patch})
  it('sorts earned ARAM challenges by rarity and tier and strips private fields',()=>{
    const cards=readOwnedChallenges({'101101':row({percentile:.4}),'101106':row({percentile:.1,currentLevel:'GRANDMASTER',position:14811,friendsAtLevels:[{friends:['private']}]}),'101108':row({percentile:.1,currentLevel:'CHALLENGER',position:16824}),'101000':row({isCapstone:true}),'201101':row({}),'101203':row({currentLevel:'NONE'}),'101204':row({currentValue:0}),'101205':row({gameModes:['CLASSIC']})})
    expect(cards.map(c=>c.id)).toEqual(['101108','101106','101101'])
    expect(cards[0]).toMatchObject({percentile:.1,rank:16824,level:'CHALLENGER'})
    expect(JSON.stringify(cards)).not.toContain('private')
  })
  it('accepts fractional LCU rarity percentages while preserving large integer ids',()=>{
    expect(parseLcuJson('{"percentile":0.1,"gameId":9007199254740993}')).toEqual({percentile:.1,gameId:'9007199254740993'})
  })
  it('omits invalid rankings rather than taking their absolute value',()=>{
    expect(readOwnedChallenges({'101101':row({position:-20,percentile:NaN})})[0]).toMatchObject({rank:null,percentile:null})
    expect(()=>readOwnedChallenges(null)).toThrow('challenge-schema')
  })
})
