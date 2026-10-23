import { describe, expect, it } from 'vitest'
import { anonymousName, friendName } from '../src/shared/privacy'
describe('anonymous labels',()=>{
 it('hides own and teammate IDs with a chosen alias',()=>{const alias=anonymousName('  Player  ','en');expect(alias).toBe('Player');expect(friendName('Secret#NA1',true,alias)).toBe("Player's friends")})
 it('uses localized defaults and restores original names when disabled',()=>{expect(anonymousName('','zh-CN')).toBe('召唤师');expect(anonymousName('','en')).toBe('Summoner');expect(friendName('Secret#NA1',false,'Player')).toBe('Secret#NA1')})
})
