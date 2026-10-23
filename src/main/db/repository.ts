import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AugmentStatus, IngestStatus, MetricRow, ModeClass, NormalizedMatch, ResultState } from '@shared/types'
import { sourceHash } from '../hash'
import { accountIdFor, matchKey } from '../identity'

interface JoinRow {
  platform_id: string
  game_id: string
  start_utc: number
  duration_seconds: number | null
  result_state: string
  ingest_status: string
  mode_class: string
  champion_id: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  champion_damage: number | null
  augment_status: string | null
  items_status: string | null
  self_participant_id: string | null
  participant_id: string | null
}

export interface ContinuationState {
  needsBackfill: boolean
  partial: boolean
  reason: string | null
  gaps: { startUtc: number; endUtc: number }[]
  pendingIds: string[]
  lastExhaustiveAt: number | null
  earliestAccessibleUtc: number | null
  historyOffset?: number
}

export interface SyncStateRecord {
  accountId: string
  lastSuccessfulScan: number | null
  latestSeenStart: number | null
  adapterVersion: string | null
  continuation: ContinuationState
}

const EMPTY_CONTINUATION: ContinuationState = {
  needsBackfill: true,
  partial: false,
  reason: null,
  gaps: [],
  pendingIds: [],
  lastExhaustiveAt: null,
  earliestAccessibleUtc: null
}

function nonNegative(value: number | null): number | null {
  if (value == null || !Number.isInteger(value) || value < 0) return null
  return value
}

function asMode(value: string): ModeClass {
  if (value === 'mayhem' || value === 'aram' || value === 'unconfirmed' || value === 'unknown') return value
  return 'unknown'
}

function asResult(value: string): ResultState {
  if (value === 'win' || value === 'loss' || value === 'remake' || value === 'unknown') return value
  return 'unknown'
}

function asIngest(value: string): IngestStatus {
  if (value === 'complete' || value === 'incomplete' || value === 'unavailable' || value === 'quarantined') return value
  return 'quarantined'
}

function asAugment(value: string | null): AugmentStatus {
  if (value === 'recorded' || value === 'explicitNone' || value === 'unavailable' || value === 'invalid') return value
  return 'unavailable'
}

export function encodeCursor(startUtc: number, gameId: string): string {
  return Buffer.from(`${startUtc}|${gameId}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): { startUtc: number; gameId: string } | null {
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8')
    const split = text.indexOf('|')
    if (split <= 0) return null
    const startUtc = Number(text.slice(0, split))
    const gameId = text.slice(split + 1)
    if (!Number.isFinite(startUtc) || gameId.length === 0) return null
    return { startUtc, gameId }
  } catch {
    return null
  }
}

export class WrappedDatabase {
  crashAfterParentInsert = false

  constructor(
    readonly file: string,
    private readonly db: Database.Database
  ) {}

  close(): void {
    this.db.close()
  }

  pragma(name: string): unknown {
    return this.db.pragma(name, { simple: true })
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  upsertAccount(input: { platformId: string; puuid: string; alias: string; now: number }): { accountId: string } {
    const accountId = accountIdFor(input.platformId, input.puuid)
    this.db.prepare(`
      INSERT INTO accounts(account_id, platform_id, puuid, alias, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform_id, puuid) DO UPDATE SET
        alias = excluded.alias,
        last_seen_at = excluded.last_seen_at
    `).run(accountId, input.platformId, input.puuid, input.alias, input.now, input.now)
    const row = this.db.prepare('SELECT account_id FROM accounts WHERE platform_id = ? AND puuid = ?').get(input.platformId, input.puuid) as { account_id: string }
    return { accountId: row.account_id }
  }

  getAccount(accountId: string): { accountId: string; platformId: string; puuid: string; alias: string } | null {
    const row = this.db.prepare('SELECT account_id, platform_id, puuid, alias FROM accounts WHERE account_id = ?').get(accountId) as
      | { account_id: string; platform_id: string; puuid: string; alias: string }
      | undefined
    if (!row) return null
    return { accountId: row.account_id, platformId: row.platform_id, puuid: row.puuid, alias: row.alias }
  }

  listPublicAccounts(): Array<{ accountId: string; alias: string }> {
    const rows = this.db.prepare('SELECT account_id, alias FROM accounts ORDER BY last_seen_at DESC').all() as Array<{ account_id: string; alias: string }>
    return rows.map((row) => ({ accountId: row.account_id, alias: row.alias }))
  }

  commitMatch(accountId: string, match: NormalizedMatch, now = Date.now()): 'inserted' | 'replaced' | 'skipped' {
    if (!Number.isFinite(match.startUtc) || match.startUtc < 0) throw new Error('invalid-timestamp')
    const hash = sourceHash(match.raw)
    const existing = this.db.prepare('SELECT source_hash AS sourceHash, ingest_status AS ingestStatus FROM matches WHERE platform_id = ? AND game_id = ?').get(match.platformId, match.gameId) as
      | { sourceHash: string | null; ingestStatus: string }
      | undefined
    if (existing && existing.sourceHash === hash && existing.ingestStatus === 'complete' && match.ingestStatus === 'complete') {
      this.linkAccount(accountId, match, now)
      return 'skipped'
    }
    const write = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO matches(
          platform_id, game_id, queue_id, mode_class, classification_version, start_utc, duration_seconds,
          result_state, patch, ingest_status, source_hash, adapter_version, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform_id, game_id) DO UPDATE SET
          queue_id = excluded.queue_id,
          mode_class = excluded.mode_class,
          classification_version = excluded.classification_version,
          start_utc = excluded.start_utc,
          duration_seconds = excluded.duration_seconds,
          result_state = excluded.result_state,
          patch = excluded.patch,
          ingest_status = excluded.ingest_status,
          source_hash = excluded.source_hash,
          adapter_version = excluded.adapter_version,
          fetched_at = excluded.fetched_at
      `).run(
        match.platformId,
        match.gameId,
        match.queueId,
        match.modeClass,
        match.classificationVersion,
        match.startUtc,
        nonNegative(match.durationSeconds),
        match.resultState,
        match.patch,
        match.ingestStatus,
        hash,
        match.adapterVersion,
        now
      )
      if (this.crashAfterParentInsert) {
        this.crashAfterParentInsert = false
        throw new Error('crash-between-parent-and-child')
      }
      for (const participant of match.participants) {
        this.db.prepare('DELETE FROM participants WHERE platform_id = ? AND game_id = ? AND participant_id = ?').run(match.platformId, match.gameId, participant.participantId)
      }
      this.db.prepare(`
        DELETE FROM participants
        WHERE platform_id = ? AND game_id = ?
          AND participant_id NOT IN (
            SELECT self_participant_id FROM account_matches
            WHERE platform_id = ? AND game_id = ? AND account_id != ? AND self_participant_id IS NOT NULL
          )
      `).run(match.platformId, match.gameId, match.platformId, match.gameId, accountId)
      const insertParticipant = this.db.prepare(`
        INSERT INTO participants(
          platform_id, game_id, participant_id, team_id, champion_id, win, kills, deaths, assists,
          champion_damage, gold, augment_status, items_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertItem = this.db.prepare(`
        INSERT INTO participant_items(platform_id, game_id, participant_id, slot, item_id) VALUES (?, ?, ?, ?, ?)
      `)
      const insertAugment = this.db.prepare(`
        INSERT INTO participant_augments(
          platform_id, game_id, participant_id, selection_slot, augment_id, source_field, order_known
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const participant of match.participants) {
        insertParticipant.run(
          match.platformId,
          match.gameId,
          participant.participantId,
          participant.teamId,
          participant.championId,
          participant.win == null ? null : participant.win ? 1 : 0,
          nonNegative(participant.kills),
          nonNegative(participant.deaths),
          nonNegative(participant.assists),
          nonNegative(participant.championDamage),
          nonNegative(participant.gold),
          participant.augmentStatus,
          participant.itemsStatus
        )
        for (const item of participant.items) {
          insertItem.run(match.platformId, match.gameId, participant.participantId, item.slot, item.itemId)
        }
        for (const augment of participant.augments) {
          insertAugment.run(
            match.platformId,
            match.gameId,
            participant.participantId,
            augment.selectionSlot,
            augment.augmentId,
            augment.sourceField,
            augment.orderKnown ? 1 : 0
          )
        }
      }
      this.db.prepare(`
        INSERT INTO raw_matches(platform_id, game_id, payload_json, source_schema, received_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(platform_id, game_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          source_schema = excluded.source_schema,
          received_at = excluded.received_at
      `).run(match.platformId, match.gameId, JSON.stringify(match.raw), match.sourceSchema, now)
      this.linkAccount(accountId, match, now)
    })
    write()
    return existing ? 'replaced' : 'inserted'
  }

  rebaseStart(platformId: string, gameId: string, startUtc: number): void {
    this.db.prepare('UPDATE matches SET start_utc = ? WHERE platform_id = ? AND game_id = ?').run(startUtc, platformId, gameId)
  }

  private linkAccount(accountId: string, match: NormalizedMatch, now: number): void {
    this.db.prepare(`
      INSERT INTO account_matches(account_id, platform_id, game_id, self_participant_id, imported_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, platform_id, game_id) DO UPDATE SET
        self_participant_id = excluded.self_participant_id
    `).run(accountId, match.platformId, match.gameId, match.selfParticipantId, now)
  }

  gamesMissingPlayerIds(accountId: string): Array<{ platformId: string; gameId: string }> {
    return this.db.prepare(`
      SELECT am.platform_id AS platformId, am.game_id AS gameId
      FROM account_matches am
      JOIN raw_matches r ON r.platform_id = am.platform_id AND r.game_id = am.game_id
      WHERE am.account_id = ? AND instr(r.payload_json, '"playerKey"') = 0
    `).all(accountId) as Array<{ platformId: string; gameId: string }>
  }

  count(table: 'matches' | 'account_matches' | 'participants' | 'participant_items' | 'participant_augments' | 'accounts' | 'raw_matches' | 'sync_failures'): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    return row.n
  }

  storageSummary(accountId: string): { stored: number; mayhemComplete: number; earliest: number | null; unverified: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS stored,
        SUM(CASE WHEN m.mode_class = 'mayhem' AND m.ingest_status = 'complete' THEN 1 ELSE 0 END) AS mayhemComplete,
        MIN(CASE WHEN m.mode_class = 'mayhem' AND m.ingest_status = 'complete' THEN m.start_utc END) AS earliest
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      WHERE am.account_id = ?
    `).get(accountId) as { stored: number; mayhemComplete: number | null; earliest: number | null }
    const mayhemComplete = row.mayhemComplete ?? 0
    return {
      stored: row.stored,
      mayhemComplete,
      earliest: row.earliest,
      unverified: row.stored - mayhemComplete
    }
  }

  loadMayhemRows(accountId: string, startUtc: number, endUtc: number): MetricRow[] {
    const rows = this.db.prepare(`
      SELECT
        m.platform_id, m.game_id, m.start_utc, m.duration_seconds, m.result_state, m.ingest_status, m.mode_class,
        p.champion_id, p.kills, p.deaths, p.assists, p.champion_damage, p.augment_status, p.items_status,
        am.self_participant_id, p.participant_id
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      LEFT JOIN participants p
        ON p.platform_id = m.platform_id AND p.game_id = m.game_id AND p.participant_id = am.self_participant_id
      WHERE am.account_id = ? AND m.mode_class = 'mayhem' AND m.start_utc >= ? AND m.start_utc < ?
    `).all(accountId, startUtc, endUtc) as JoinRow[]
    const augments = this.groupedStrings(accountId, startUtc, endUtc, 'participant_augments', 'augment_id')
    const items = this.groupedNumbers(accountId, startUtc, endUtc)
    return rows.map((row) => {
      const key = matchKey(row.platform_id, row.game_id)
      const missingSelf = row.self_participant_id == null || row.participant_id == null
      return {
        platformId: row.platform_id,
        gameId: row.game_id,
        startUtc: row.start_utc,
        durationSeconds: row.duration_seconds,
        resultState: asResult(row.result_state),
        championId: row.champion_id,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        championDamage: row.champion_damage,
        augmentStatus: asAugment(row.augment_status),
        augmentIds: augments.get(key) ?? [],
        itemsStatus: row.items_status === 'readable' ? 'readable' : 'unavailable',
        itemIds: items.get(key) ?? [],
        quarantined: missingSelf || row.ingest_status === 'quarantined',
        ingestStatus: missingSelf ? 'quarantined' : asIngest(row.ingest_status),
        modeClass: asMode(row.mode_class),
        selfParticipantId: row.self_participant_id
      }
    })
  }

  private groupedStrings(accountId: string, startUtc: number, endUtc: number, table: 'participant_augments', column: 'augment_id'): Map<string, string[]> {
    const rows = this.db.prepare(`
      SELECT a.platform_id, a.game_id, a.${column} AS value
      FROM ${table} a
      JOIN account_matches am
        ON am.platform_id = a.platform_id AND am.game_id = a.game_id AND am.self_participant_id = a.participant_id
      JOIN matches m ON m.platform_id = a.platform_id AND m.game_id = a.game_id
      WHERE am.account_id = ? AND m.start_utc >= ? AND m.start_utc < ?
      ORDER BY a.selection_slot ASC
    `).all(accountId, startUtc, endUtc) as Array<{ platform_id: string; game_id: string; value: string }>
    const grouped = new Map<string, string[]>()
    for (const row of rows) {
      const key = matchKey(row.platform_id, row.game_id)
      const list = grouped.get(key) ?? []
      list.push(row.value)
      grouped.set(key, list)
    }
    return grouped
  }

  private groupedNumbers(accountId: string, startUtc: number, endUtc: number): Map<string, number[]> {
    const rows = this.db.prepare(`
      SELECT a.platform_id, a.game_id, a.item_id AS value
      FROM participant_items a
      JOIN account_matches am
        ON am.platform_id = a.platform_id AND am.game_id = a.game_id AND am.self_participant_id = a.participant_id
      JOIN matches m ON m.platform_id = a.platform_id AND m.game_id = a.game_id
      WHERE am.account_id = ? AND m.start_utc >= ? AND m.start_utc < ?
      ORDER BY a.slot ASC
    `).all(accountId, startUtc, endUtc) as Array<{ platform_id: string; game_id: string; value: number }>
    const grouped = new Map<string, number[]>()
    for (const row of rows) {
      const key = matchKey(row.platform_id, row.game_id)
      const list = grouped.get(key) ?? []
      list.push(row.value)
      grouped.set(key, list)
    }
    return grouped
  }

  listMatches(input: {
    accountId: string
    startUtc: number
    endUtc: number
    championId: number | null
    augmentId: string | null
    itemId: number | null
    cursor: { startUtc: number; gameId: string } | null
    limit?: number
  }): { rows: Array<Record<string, unknown>>; total: number } {
    const limit = input.limit ?? 50
    const filters = `
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      JOIN participants p ON p.platform_id = m.platform_id AND p.game_id = m.game_id AND p.participant_id = am.self_participant_id
      WHERE am.account_id = @accountId
        AND m.mode_class = 'mayhem'
        AND m.ingest_status = 'complete'
        AND m.start_utc >= @startUtc
        AND m.start_utc < @endUtc
        AND (@championId IS NULL OR p.champion_id = @championId)
        AND (@augmentId IS NULL OR EXISTS (
          SELECT 1 FROM participant_augments aug
          WHERE aug.platform_id = m.platform_id AND aug.game_id = m.game_id
            AND aug.participant_id = am.self_participant_id AND aug.augment_id = @augmentId
        ))
        AND (@itemId IS NULL OR EXISTS (
          SELECT 1 FROM participant_items item
          WHERE item.platform_id = m.platform_id AND item.game_id = m.game_id
            AND item.participant_id = am.self_participant_id AND item.item_id = @itemId AND item.item_id != 0
        ))
    `
    const params = {
      accountId: input.accountId,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      championId: input.championId,
      augmentId: input.augmentId,
      itemId: input.itemId,
      cursorStart: input.cursor?.startUtc ?? null,
      cursorGame: input.cursor?.gameId ?? null,
      limit
    }
    const total = this.db.prepare(`SELECT COUNT(*) AS n ${filters}`).get(params) as { n: number }
    const rows = this.db.prepare(`
      SELECT m.platform_id, m.game_id, m.start_utc, m.duration_seconds, m.result_state, m.patch, m.queue_id,
             p.participant_id, p.champion_id, p.kills, p.deaths, p.assists, p.champion_damage, p.gold,
             p.augment_status, p.items_status
      ${filters}
        AND (@cursorStart IS NULL OR m.start_utc < @cursorStart OR (m.start_utc = @cursorStart AND m.game_id < @cursorGame))
      ORDER BY m.start_utc DESC, m.game_id DESC
      LIMIT @limit
    `).all(params) as Array<Record<string, unknown>>
    return { rows, total: total.n }
  }

  matchChildren(platformId: string, gameId: string, participantId: string): { items: Array<{ slot: number; itemId: number }>; augments: Array<{ selectionSlot: number; augmentId: string; sourceField: string; orderKnown: boolean }> } {
    const items = this.db.prepare(`
      SELECT slot, item_id AS itemId FROM participant_items
      WHERE platform_id = ? AND game_id = ? AND participant_id = ? ORDER BY slot ASC
    `).all(platformId, gameId, participantId) as Array<{ slot: number; itemId: number }>
    const augments = this.db.prepare(`
      SELECT selection_slot AS selectionSlot, augment_id AS augmentId, source_field AS sourceField, order_known AS orderKnown
      FROM participant_augments
      WHERE platform_id = ? AND game_id = ? AND participant_id = ? ORDER BY selection_slot ASC
    `).all(platformId, gameId, participantId) as Array<{ selectionSlot: number; augmentId: string; sourceField: string; orderKnown: number }>
    return {
      items,
      augments: augments.map((row) => ({ ...row, orderKnown: row.orderKnown === 1 }))
    }
  }

  getOwnedMatch(accountId: string, platformId: string, gameId: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT m.platform_id, m.game_id, m.start_utc, m.duration_seconds, m.result_state, m.patch, m.queue_id,
             p.participant_id, p.champion_id, p.kills, p.deaths, p.assists, p.champion_damage, p.gold,
             p.augment_status, p.items_status
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      JOIN participants p ON p.platform_id = m.platform_id AND p.game_id = m.game_id AND p.participant_id = am.self_participant_id
      WHERE am.account_id = ? AND m.platform_id = ? AND m.game_id = ?
        AND m.mode_class = 'mayhem' AND m.ingest_status = 'complete'
    `).get(accountId, platformId, gameId) as Record<string, unknown> | undefined
    return row ?? null
  }

  listParticipants(platformId: string, gameId: string): Array<Record<string, unknown>> {
    return this.db.prepare(`
      SELECT participant_id, team_id, champion_id, win, kills, deaths, assists
      FROM participants WHERE platform_id = ? AND game_id = ? ORDER BY participant_id ASC
    `).all(platformId, gameId) as Array<Record<string, unknown>>
  }

  deleteAccount(accountId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM accounts WHERE account_id = ?').run(accountId)
      this.db.prepare(`
        DELETE FROM matches
        WHERE NOT EXISTS (
          SELECT 1 FROM account_matches am
          WHERE am.platform_id = matches.platform_id AND am.game_id = matches.game_id
        )
      `).run()
    })
    tx()
  }

  createRun(accountId: string, now: number): string {
    const runId = `run_${now.toString(36)}_${randomBytes(3).toString('hex')}`
    this.db.prepare(`
      INSERT INTO sync_runs(run_id, account_id, started_at, state, discovered, committed, skipped, failed)
      VALUES (?, ?, ?, 'identifying', 0, 0, 0, 0)
    `).run(runId, accountId, now)
    return runId
  }

  updateRun(runId: string, patch: { state?: string; discovered?: number; committed?: number; skipped?: number; failed?: number }): void {
    this.db.prepare(`
      UPDATE sync_runs
      SET state = COALESCE(?, state),
          discovered = COALESCE(?, discovered),
          committed = COALESCE(?, committed),
          skipped = COALESCE(?, skipped),
          failed = COALESCE(?, failed)
      WHERE run_id = ?
    `).run(patch.state ?? null, patch.discovered ?? null, patch.committed ?? null, patch.skipped ?? null, patch.failed ?? null, runId)
  }

  finishRun(runId: string, patch: { state: string; termination: string; diagnostic: string | null; earliestAccessibleUtc: number | null; now: number; discovered: number; committed: number; skipped: number; failed: number }): void {
    this.db.prepare(`
      UPDATE sync_runs
      SET finished_at = ?, state = ?, termination_reason = ?, diagnostic_code = ?, earliest_accessible_utc = ?,
          discovered = ?, committed = ?, skipped = ?, failed = ?
      WHERE run_id = ?
    `).run(patch.now, patch.state, patch.termination, patch.diagnostic, patch.earliestAccessibleUtc, patch.discovered, patch.committed, patch.skipped, patch.failed, runId)
  }

  readSyncState(accountId: string): SyncStateRecord | null {
    const row = this.db.prepare(`
      SELECT last_successful_scan AS lastSuccessfulScan, latest_seen_start AS latestSeenStart,
             continuation_json AS continuationJson, adapter_version AS adapterVersion
      FROM sync_state WHERE account_id = ?
    `).get(accountId) as
      | { lastSuccessfulScan: number | null; latestSeenStart: number | null; continuationJson: string | null; adapterVersion: string | null }
      | undefined
    if (!row) return null
    let continuation = EMPTY_CONTINUATION
    if (row.continuationJson) {
      try {
        continuation = { ...EMPTY_CONTINUATION, ...JSON.parse(row.continuationJson) as ContinuationState }
      } catch {
        continuation = EMPTY_CONTINUATION
      }
    }
    return {
      accountId,
      lastSuccessfulScan: row.lastSuccessfulScan,
      latestSeenStart: row.latestSeenStart,
      adapterVersion: row.adapterVersion,
      continuation
    }
  }

  writeSyncState(accountId: string, state: { lastSuccessfulScan: number | null; latestSeenStart: number | null; adapterVersion: string; continuation: ContinuationState }): void {
    this.db.prepare(`
      INSERT INTO sync_state(account_id, last_successful_scan, latest_seen_start, continuation_json, adapter_version)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        last_successful_scan = excluded.last_successful_scan,
        latest_seen_start = excluded.latest_seen_start,
        continuation_json = excluded.continuation_json,
        adapter_version = excluded.adapter_version
    `).run(accountId, state.lastSuccessfulScan, state.latestSeenStart, JSON.stringify(state.continuation), state.adapterVersion)
  }

  completeKeys(accountId: string): Set<string> {
    const rows = this.db.prepare(`
      SELECT m.platform_id, m.game_id
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      WHERE am.account_id = ? AND m.ingest_status = 'complete'
    `).all(accountId) as Array<{ platform_id: string; game_id: string }>
    return new Set(rows.map((row) => matchKey(row.platform_id, row.game_id)))
  }

  newestKnownIds(accountId: string, limit: number): string[] {
    const rows = this.db.prepare(`
      SELECT m.platform_id, m.game_id
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      WHERE am.account_id = ? AND m.ingest_status = 'complete'
      ORDER BY m.start_utc DESC, m.game_id DESC
      LIMIT ?
    `).all(accountId, limit) as Array<{ platform_id: string; game_id: string }>
    return rows.map((row) => matchKey(row.platform_id, row.game_id))
  }

  quarantinedKeys(accountId: string): Set<string> {
    const rows = this.db.prepare(`
      SELECT m.platform_id, m.game_id
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      WHERE am.account_id = ? AND m.ingest_status = 'quarantined'
    `).all(accountId) as Array<{ platform_id: string; game_id: string }>
    return new Set(rows.map((row) => matchKey(row.platform_id, row.game_id)))
  }

  incompleteKeys(accountId: string): Set<string> {
    const rows = this.db.prepare(`
      SELECT m.platform_id, m.game_id
      FROM account_matches am
      JOIN matches m ON m.platform_id = am.platform_id AND m.game_id = am.game_id
      WHERE am.account_id = ? AND m.ingest_status = 'incomplete'
    `).all(accountId) as Array<{ platform_id: string; game_id: string }>
    return new Set(rows.map((row) => matchKey(row.platform_id, row.game_id)))
  }

  dueRetryKeys(accountId: string, now: number): Set<string> {
    const rows = this.db.prepare(`
      SELECT platform_id, game_id FROM sync_failures
      WHERE account_id = ? AND next_retry_at IS NOT NULL AND next_retry_at <= ?
    `).all(accountId, now) as Array<{ platform_id: string; game_id: string }>
    return new Set(rows.map((row) => matchKey(row.platform_id, row.game_id)))
  }

  recordFailure(accountId: string, platformId: string, gameId: string, errorCode: string, nextRetryAt: number | null, now: number): void {
    this.db.prepare(`
      INSERT INTO sync_failures(account_id, platform_id, game_id, attempts, next_retry_at, error_code, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(account_id, platform_id, game_id) DO UPDATE SET
        attempts = sync_failures.attempts + 1,
        next_retry_at = excluded.next_retry_at,
        error_code = excluded.error_code,
        updated_at = excluded.updated_at
    `).run(accountId, platformId, gameId, nextRetryAt, errorCode, now)
  }

  clearFailure(accountId: string, platformId: string, gameId: string): void {
    this.db.prepare('DELETE FROM sync_failures WHERE account_id = ? AND platform_id = ? AND game_id = ?').run(accountId, platformId, gameId)
  }

  failureCount(accountId: string, platformId: string, gameId: string): { attempts: number; errorCode: string; nextRetryAt: number | null } | null {
    const row = this.db.prepare(`
      SELECT attempts, error_code AS errorCode, next_retry_at AS nextRetryAt
      FROM sync_failures WHERE account_id = ? AND platform_id = ? AND game_id = ?
    `).get(accountId, platformId, gameId) as { attempts: number; errorCode: string; nextRetryAt: number | null } | undefined
    return row ?? null
  }

  rawPayload(platformId: string, gameId: string): string | null {
    const row = this.db.prepare('SELECT payload_json AS payload FROM raw_matches WHERE platform_id = ? AND game_id = ?').get(platformId, gameId) as { payload: string } | undefined
    return row?.payload ?? null
  }
}
