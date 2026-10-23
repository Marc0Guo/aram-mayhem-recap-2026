import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { SCHEMA_VERSION, applyMigrations, configureDatabase, readSchemaVersion, type Migration, MIGRATIONS } from './migrate'
import { WrappedDatabase } from './repository'

export interface OpenResult {
  database: WrappedDatabase | null
  schemaBlocked: { found: number; supported: number } | null
  recoveryPath: string | null
}

function pause(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* Windows can keep a SQLite handle for a moment after close. */
  }
}

function removeFile(file: string): void {
  let last: unknown
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(file, { force: true })
      return
    } catch (error) {
      last = error
      pause(40)
    }
  }
  throw last
}

function preserveCorrupt(file: string): string {
  const backups = path.join(path.dirname(path.dirname(file)), 'backups')
  fs.mkdirSync(backups, { recursive: true })
  const dest = path.join(backups, `recovery-${Date.now()}.sqlite`)
  if (fs.existsSync(file)) fs.copyFileSync(file, dest)
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${file}${suffix}`
    if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, `${dest}${suffix}`)
    removeFile(sidecar)
  }
  removeFile(file)
  return dest
}

async function openFresh(file: string, migrations: Migration[], recoveryPath: string | null): Promise<OpenResult> {
  const db = new Database(file)
  configureDatabase(db)
  await applyMigrations(db, file, migrations)
  return { database: new WrappedDatabase(file, db), schemaBlocked: null, recoveryPath }
}

export async function openWrappedDatabase(file: string, migrations: Migration[] = MIGRATIONS): Promise<OpenResult> {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const supported = migrations.reduce((max, migration) => Math.max(max, migration.version), SCHEMA_VERSION)
  let db: Database.Database | null = null
  try {
    db = new Database(file)
    configureDatabase(db)
    const check = db.pragma('quick_check', { simple: true })
    if (check !== 'ok') {
      db.close()
      db = null
      const recoveryPath = preserveCorrupt(file)
      return openFresh(file, migrations, recoveryPath)
    }
    const found = readSchemaVersion(db)
    if (found != null && found > supported) {
      return {
        database: new WrappedDatabase(file, db),
        schemaBlocked: { found, supported },
        recoveryPath: null
      }
    }
    await applyMigrations(db, file, migrations)
    return { database: new WrappedDatabase(file, db), schemaBlocked: null, recoveryPath: null }
  } catch {
    try {
      db?.close()
    } catch {
      /* The failed open may already have released its handle. */
    }
    const recoveryPath = fs.existsSync(file) ? preserveCorrupt(file) : null
    return openFresh(file, migrations, recoveryPath)
  }
}
