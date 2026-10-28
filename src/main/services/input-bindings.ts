import fs from 'node:fs'
import path from 'node:path'

export type MovementMode = 'mouse' | 'wasd' | 'unknown'
export interface InputBindings {
  movementMode: MovementMode
  spellKeys: [string | null, string | null]
}
type Sections = Map<string, Map<string, string>>
interface Snapshot { time: number; game: Sections; input: Sections }
const empty = (): Sections => new Map()

function set(sections: Sections, section: string, key: string, value: string): void {
  const name = section.toLowerCase()
  if (!sections.has(name)) sections.set(name, new Map())
  sections.get(name)!.set(key.toLowerCase(), value)
}
function merge(target: Sections, source: Sections): void {
  for (const [section, settings] of source) for (const [key, value] of settings) set(target, section, key, value)
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
export function persistedInput(payload: unknown): { game: Sections; input: Sections } {
  const result = { game: empty(), input: empty() }
  const files = record(payload)?.files
  if (!Array.isArray(files)) return result
  for (const rawFile of files) {
    const file = record(rawFile)
    const name = typeof file?.name === 'string' ? file.name.toLowerCase() : ''
    const target = name === 'input.ini' ? result.input : name === 'game.cfg' ? result.game : null
    if (!target || !Array.isArray(file?.sections)) continue
    for (const rawSection of file.sections) {
      const section = record(rawSection)
      if (typeof section?.name !== 'string' || !Array.isArray(section.settings)) continue
      // Retain empty WASD sections: their presence means this is a modern dual-profile config.
      if (!target.has(section.name.toLowerCase())) target.set(section.name.toLowerCase(), new Map())
      for (const rawSetting of section.settings) {
        const setting = record(rawSetting)
        if (typeof setting?.name === 'string' && typeof setting.value === 'string') set(target, section.name, setting.name, setting.value)
      }
    }
  }
  return result
}
function ini(text: string): Sections {
  const sections = empty()
  let section = ''
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const value = line.trim()
    if (!value || /^[;#]/.test(value)) continue
    const heading = /^\[([^\]]+)\]$/.exec(value)
    if (heading) { section = heading[1].toLowerCase(); if (!sections.has(section)) sections.set(section, new Map()); continue }
    const equal = value.indexOf('=')
    if (section && equal > 0) set(sections, section, value.slice(0, equal).trim(), value.slice(equal + 1).trim())
  }
  return sections
}
export function bindingLabel(value: string | undefined): string | null {
  if (value == null) return null
  for (const binding of value.split(',')) {
    const candidate = binding.trim()
    if (!candidate || candidate === 'null' || candidate.includes('<Unbound>')) continue
    if (!/^(\[[A-Za-z0-9 +_-]+\]){1,4}$/.test(candidate)) continue
    const keys = [...candidate.matchAll(/\[([^\]]+)\]/g)].map(match => match[1])
    return keys.map(key => key.length === 1 ? key.toUpperCase() : key).join('+')
  }
  return null
}
export function resolveInputBindings(game: Sections, input: Sections): InputBindings {
  // CameraModeWASD controls the camera, not the movement profile.
  const selected = game.get('hud')?.get('movement mode')?.trim()
  const movementMode: MovementMode = selected === '1' ? 'wasd' : selected === '0' ? 'mouse'
    : selected == null && !input.has('wasd') && input.has('gameevents') ? 'mouse' : 'unknown'
  if (movementMode === 'unknown') return { movementMode, spellKeys: [null, null] }
  const section = input.get(movementMode === 'wasd' ? 'wasd' : 'gameevents')
  const spellKeys = ([1, 2] as const).map(slot => {
    const event = 'castavatarspell' + slot
    const value = movementMode === 'wasd'
      ? section?.get(event) ?? section?.get('evt' + event)
      : section?.get('evt' + event)
    if (value !== undefined) return bindingLabel(value)
    // Riot documents independent WASD defaults Q/F. Only use them after positive mode detection.
    return movementMode === 'wasd' ? (slot === 1 ? 'Q' : 'F') : null
  }) as [string | null, string | null]
  return { movementMode, spellKeys }
}
export function readInputBindings(leagueDir: string): InputBindings {
  const config = path.join(leagueDir, 'Config')
  const snapshots: Snapshot[] = []
  for (const name of ['PersistedSettings.json', 'game.cfg', 'input.ini']) {
    try {
      const file = path.join(config, name)
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
      const data = name === 'PersistedSettings.json' ? persistedInput(JSON.parse(text))
        : name === 'game.cfg' ? { game: ini(text), input: empty() } : { game: empty(), input: ini(text) }
      snapshots.push({ ...data, time: fs.statSync(file).mtimeMs })
    } catch { /* Missing or malformed files never produce guessed mouse bindings. */ }
  }
  const game = empty(), input = empty()
  for (const snapshot of snapshots.sort((a, b) => a.time - b.time)) { merge(game, snapshot.game); merge(input, snapshot.input) }
  return resolveInputBindings(game, input)
}
