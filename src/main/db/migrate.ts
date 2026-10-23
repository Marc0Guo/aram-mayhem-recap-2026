import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

export const SCHEMA_VERSION = 1

export interface Migration {
  version: number
  description: string
  up: (db: Database.Database) => void
}

const INITIAL_SQL = `
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  alias TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(platform_id, puuid)
);
CREATE TABLE matches (
  platform_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  queue_id INTEGER,
  mode_class TEXT NOT NULL,
  classification_version TEXT NOT NULL,
  start_utc INTEGER NOT NULL,
  duration_seconds INTEGER,
  result_state TEXT NOT NULL,
  patch TEXT,
  ingest_status TEXT NOT NULL,
  source_hash TEXT,
  adapter_version TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (platform_id, game_id)
);
CREATE TABLE account_matches (
  account_id TEXT NOT NULL,
  platform_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  self_participant_id TEXT,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, platform_id, game_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
  FOREIGN KEY (platform_id, game_id) REFERENCES matches(platform_id, game_id) ON DELETE CASCADE
);
CREATE TABLE participants (
  platform_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  team_id TEXT,
  champion_id INTEGER,
  win INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  champion_damage INTEGER,
  gold INTEGER,
  augment_status TEXT NOT NULL,
  items_status TEXT NOT NULL,
  PRIMARY KEY (platform_id, game_id, participant_id),
  FOREIGN KEY (platform_id, game_id) REFERENCES matches(platform_id, game_id) ON DELETE CASCADE
);
CREATE TABLE participant_items (
  platform_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot >= 0 AND slot <= 6),
  item_id INTEGER NOT NULL,
  PRIMARY KEY (platform_id, game_id, participant_id, slot),
  FOREIGN KEY (platform_id, game_id, participant_id)
    REFERENCES participants(platform_id, game_id, participant_id) ON DELETE CASCADE
);
CREATE TABLE participant_augments (
  platform_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  selection_slot INTEGER NOT NULL,
  augment_id TEXT NOT NULL,
  source_field TEXT NOT NULL,
  order_known INTEGER NOT NULL CHECK (order_known IN (0, 1)),
  PRIMARY KEY (platform_id, game_id, participant_id, selection_slot),
  FOREIGN KEY (platform_id, game_id, participant_id)
    REFERENCES participants(platform_id, game_id, participant_id) ON DELETE CASCADE
);
CREATE TABLE raw_matches (
  platform_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_schema TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (platform_id, game_id),
  FOREIGN KEY (platform_id, game_id) REFERENCES matches(platform_id, game_id) ON DELETE CASCADE
);
CREATE TABLE sync_runs (
  run_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  state TEXT NOT NULL,
  discovered INTEGER NOT NULL DEFAULT 0,
  committed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  earliest_accessible_utc INTEGER,
  termination_reason TEXT,
  diagnostic_code TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);
CREATE TABLE sync_failures (
  account_id TEXT NOT NULL,
  platform_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  next_retry_at INTEGER,
  error_code TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, platform_id, game_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);
CREATE TABLE sync_state (
  account_id TEXT PRIMARY KEY,
  last_successful_scan INTEGER,
  latest_seen_start INTEGER,
  continuation_json TEXT,
  adapter_version TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);
CREATE TABLE asset_manifest (
  provider TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  locale TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_url TEXT,
  relative_file TEXT,
  sha256 TEXT,
  fetched_at INTEGER,
  status TEXT NOT NULL,
  PRIMARY KEY (provider, provider_version, locale, entity_type, entity_id)
);
CREATE INDEX idx_matches_mode_start ON matches(mode_class, start_utc);
CREATE INDEX idx_account_matches_account ON account_matches(account_id);
CREATE INDEX idx_participants_champion ON participants(champion_id);
CREATE INDEX idx_items_item ON participant_items(item_id);
CREATE INDEX idx_augments_augment ON participant_augments(augment_id);
`

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'initial personal history schema',
    up: (db) => {
      db.exec(INITIAL_SQL)
    }
  }
]

export function configureDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
}

export function readSchemaVersion(db: Database.Database): number | null {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get() as { name: string } | undefined
  if (!table) return null
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number | null }
  return row.version ?? 0
}

export async function applyMigrations(db: Database.Database, file: string, migrations: Migration[]): Promise<void> {
  const current = readSchemaVersion(db) ?? 0
  const pending = migrations.filter((migration) => migration.version > current).sort((a, b) => a.version - b.version)
  if (pending.length === 0) return
  if (current > 0) {
    const backups = path.join(path.dirname(path.dirname(file)), 'backups')
    fs.mkdirSync(backups, { recursive: true })
    const target = pending[pending.length - 1]?.version ?? current
    const dest = path.join(backups, `pre-migrate-${current}-to-${target}-${Date.now()}.sqlite`)
    await db.backup(dest)
  }
  for (const migration of pending) {
    const tx = db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_version(version, applied_at, description) VALUES (?, ?, ?)').run(
        migration.version,
        Date.now(),
        migration.description
      )
    })
    tx()
  }
}
