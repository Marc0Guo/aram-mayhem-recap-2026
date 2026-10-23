import os from 'node:os'
import path from 'node:path'

export interface AppPaths {
  mode: 'demo' | 'real'
  offline: boolean
  root: string
  dataDir: string
  dbFile: string
  assetsDir: string
  logsDir: string
  backupsDir: string
}

export function resolveRoots(env: NodeJS.ProcessEnv = process.env): Pick<AppPaths, 'mode' | 'offline' | 'root'> {
  const mode = env.ARAM_WRAPPED_MODE === 'demo' ? 'demo' : 'real'
  const offline = mode === 'demo' || env.ARAM_WRAPPED_OFFLINE === '1' || env.ARAM_WRAPPED_OFFLINE === 'true'
  const override = env.ARAM_WRAPPED_DATA_DIR
  if (override) return { mode, offline, root: override }
  const base = process.platform === 'win32'
    ? path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'AramMayhemWrapped')
    : path.join(os.homedir(), '.aram-mayhem-wrapped')
  return { mode, offline, root: mode === 'demo' ? path.join(base, 'demo') : base }
}

export function layoutFromRoot(root: string, mode: 'demo' | 'real', offline: boolean): AppPaths {
  return {
    mode,
    offline,
    root,
    dataDir: path.join(root, 'data'),
    dbFile: path.join(root, 'data', 'wrapped.sqlite'),
    assetsDir: path.join(root, 'assets'),
    logsDir: path.join(root, 'logs'),
    backupsDir: path.join(root, 'backups')
  }
}
