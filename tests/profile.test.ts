import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readInputBindings } from '../src/main/services/input-bindings'
import { readSpellKeys } from '../src/main/services/profile'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir,{recursive:true,force:true}) })
function config(mode: string | null, mouse: Record<string,string>, wasd?: Record<string,string>) {
  const section = (name: string, values: Record<string,string>) => ({name,settings:Object.entries(values).map(([name,value])=>({name,value}))})
  return {files:[
    {name:'Game.cfg',sections:[section('General',{CameraModeWASD:'1'}),section('HUD',mode == null ? {} : {'Movement Mode':mode})]},
    {name:'Input.ini',sections:[section('GameEvents',mouse),...(wasd === undefined ? [] : [section('WASD',wasd)])]}
  ]}
}
function directory(payload: unknown) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aram-keys-'));directories.push(dir)
  fs.mkdirSync(path.join(dir,'Config'))
  fs.writeFileSync(path.join(dir,'Config/PersistedSettings.json'),JSON.stringify(payload))
  return dir
}
describe('local spell bindings', () => {
  it('keeps explicit legacy mouse bindings without mistaking champion Q for a summoner spell', () => {
    const dir=directory(config(null,{evtCastAvatarSpell1:'[x]',evtCastAvatarSpell2:'[f]',evtCastSpell1:'[q]'}))
    expect(readSpellKeys(dir)).toEqual(['X','F'])
  })
  it('uses independent WASD Q/F defaults only after detecting WASD, ignoring stale mouse D/F bindings', () => {
    const dir=directory(config('1',{evtCastAvatarSpell1:'[d]',evtCastAvatarSpell2:'[f]'},{}))
    expect(readInputBindings(dir)).toEqual({movementMode:'wasd',spellKeys:['Q','F']})
  })
  it('respects custom WASD summoner keys and does not replace explicit unbound values with defaults', () => {
    const dir=directory(config('1',{evtCastAvatarSpell1:'[d]'},{CastAvatarSpell1:'[Ctrl][x],',CastAvatarSpell2:'[<Unbound>]'}))
    expect(readInputBindings(dir)).toEqual({movementMode:'wasd',spellKeys:['Ctrl+X',null]})
  })
  it('does not treat the WASD camera flag or an inactive WASD binding as the movement mode', () => {
    const dir=directory(config('0',{evtCastAvatarSpell1:'[d]',evtCastAvatarSpell2:'[f]'},{CastAvatarSpell1:'[q]'}))
    expect(readInputBindings(dir)).toEqual({movementMode:'mouse',spellKeys:['D','F']})
  })
  it.each([null,'2'])('hides bindings when the dual-profile configuration does not identify an active mode (%s)', mode => {
    const dir=directory(config(mode,{evtCastAvatarSpell1:'[d]'},{CastAvatarSpell1:'[q]'}))
    expect(readInputBindings(dir)).toEqual({movementMode:'unknown',spellKeys:[null,null]})
  })
  it('reads active WASD bindings from raw ini files if persisted JSON is missing', () => {
    const dir=directory({})
    fs.writeFileSync(path.join(dir,'Config/game.cfg'),'[HUD]\nMovement Mode=1\n')
    fs.writeFileSync(path.join(dir,'Config/input.ini'),'[GameEvents]\nevtCastAvatarSpell1=[d]\n[WASD]\nCastAvatarSpell1=[q]\nCastAvatarSpell2=[Button 4]\n')
    expect(readInputBindings(dir)).toEqual({movementMode:'wasd',spellKeys:['Q','Button 4']})
  })
  it('prefers a newer explicit binding and never modifies the input files', () => {
    const dir=directory(config('1',{}, {CastAvatarSpell1:'[q]'}))
    const persisted=path.join(dir,'Config/PersistedSettings.json')
    fs.utimesSync(persisted,new Date(1000),new Date(1000))
    const input=path.join(dir,'Config/input.ini')
    const text='[WASD]\nCastAvatarSpell1=[z]\n'
    fs.writeFileSync(input,text);fs.utimesSync(input,new Date(2000),new Date(2000))
    expect(readSpellKeys(dir)).toEqual(['Z','F'])
    expect(fs.readFileSync(input,'utf8')).toBe(text)
  })
  it('does not invent a binding for malformed or unavailable settings', () => {
    const dir=directory({files:'bad-schema'})
    expect(readSpellKeys(dir)).toEqual([null,null])
    fs.writeFileSync(path.join(dir,'Config/PersistedSettings.json'),'{broken')
    expect(readSpellKeys(dir)).toEqual([null,null])
  })
})
