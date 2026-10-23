import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSpellKeys } from '../src/main/services/profile'
describe('local spell bindings', () => {
  it('reads only the explicitly configured summoner spell keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-keys-'))
    try { fs.mkdirSync(path.join(dir, 'Config')); fs.writeFileSync(path.join(dir, 'Config/PersistedSettings.json'), JSON.stringify({ files: [{ name: 'Input.ini', sections: [{ name: 'GameEvents', settings: [{ name: 'evtCastAvatarSpell1', value: '[x]' }, { name: 'evtCastAvatarSpell2', value: '[f]' }, { name: 'evtCastSpell1', value: '[q]' }] }] }] })); expect(readSpellKeys(dir)).toEqual(['X', 'F']); fs.writeFileSync(path.join(dir, 'Config/PersistedSettings.json'), '{}'); expect(readSpellKeys(dir)).toEqual([null,null]) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
