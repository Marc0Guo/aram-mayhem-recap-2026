import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface LockfileParts {
  name: string
  pid: number
  port: number
  password: string
  protocol: string
}

export type DiscoveryState = 'found' | 'missing' | 'stale' | 'malformed' | 'wrong-service'

export interface PublicDiscovery {
  state: DiscoveryState
  port: number | null
  installDir: string | null
}

export interface SecretDiscovery extends PublicDiscovery {
  password: string | null
}

export const DEFAULT_LEAGUE_DIR = 'C:\\Riot Games\\League of Legends'

export function parseLockfile(text: string): LockfileParts | null {
  const parts = text.trim().split(':')
  if (parts.length < 5) return null
  const name = parts[0] ?? ''
  const pid = Number(parts[1])
  const port = Number(parts[2])
  const protocol = parts[parts.length - 1] ?? ''
  const password = parts.slice(3, -1).join(':')
  if (!name || !Number.isInteger(pid) || pid <= 0) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!password || protocol !== 'https') return null
  return { name, pid, port, password, protocol }
}

export function tasklistShowsLeague(stdout: string, pid: number): boolean {
  const match = stdout.match(new RegExp(`"([^"]+)"\\s*,\\s*"${pid}"`, 'i'))
  if (!match?.[1]) return false
  return /^LeagueClient/i.test(match[1])
}

export function windowsPidIsLeague(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    const stdout = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 5000,
      encoding: 'utf8'
    })
    return tasklistShowsLeague(String(stdout), pid)
  } catch {
    return false
  }
}

export function discoverInstall(options: {
  preferredDir?: string | null
  defaultDir?: string
  readFile: (file: string) => string | null
  pidAlive: (pid: number) => boolean
}): SecretDiscovery {
  const preferred = options.preferredDir?.trim() || null
  const fallback = options.defaultDir ?? DEFAULT_LEAGUE_DIR
  const ordered: Array<{ dir: string; preferred: boolean }> = []
  if (preferred) ordered.push({ dir: preferred, preferred: true })
  if (!preferred || path.resolve(preferred).toLowerCase() !== path.resolve(fallback).toLowerCase()) {
    ordered.push({ dir: fallback, preferred: false })
  }
  let fallbackState: SecretDiscovery | null = null
  for (const entry of ordered) {
    const text = options.readFile(path.join(entry.dir, 'lockfile'))
    if (text == null) continue
    const parsed = parseLockfile(text)
    if (!parsed) {
      const result: SecretDiscovery = { state: 'malformed', port: null, installDir: entry.dir, password: null }
      if (entry.preferred) return result
      fallbackState = result
      continue
    }
    if (parsed.port === 2999) {
      const result: SecretDiscovery = { state: 'wrong-service', port: parsed.port, installDir: entry.dir, password: null }
      if (entry.preferred) return result
      fallbackState = result
      continue
    }
    if (!options.pidAlive(parsed.pid)) {
      const result: SecretDiscovery = { state: 'stale', port: null, installDir: entry.dir, password: null }
      if (entry.preferred) return result
      fallbackState = result
      continue
    }
    return { state: 'found', port: parsed.port, installDir: entry.dir, password: parsed.password }
  }
  return fallbackState ?? { state: 'missing', port: null, installDir: null, password: null }
}

export function toPublicDiscovery(result: SecretDiscovery): PublicDiscovery {
  return { state: result.state, port: result.port, installDir: result.installDir }
}

export function readLockfile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
