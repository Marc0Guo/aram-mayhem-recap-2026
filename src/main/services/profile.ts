import { readInputBindings } from './input-bindings'
import { readOwnedChallenges } from '@shared/owned-challenges'
import { parseLcuJson } from '@shared/ids'
import type { AccountProfile } from '@shared/types'
import { lcuGet } from '../lcu/transport'
import type { LcuConnection } from '../lcu/session'
import type { WrappedDatabase } from '../db/repository'

export async function refreshAccountProfile(db: WrappedDatabase, accountId: string, connection: LcuConnection, leagueDir: string, offline: () => boolean): Promise<void> {
  if (offline()) return
  const account = db.getAccount(accountId)
  if (!account) return
  const get = async (resourcePath: string) => { const r = await lcuGet({ ...connection, resourcePath, offline: offline() }); if (r.status !== 200) throw new Error('profile-unavailable'); return parseLcuJson(r.body) }
  const self = await get('/lol-summoner/v1/current-summoner') as Record<string, unknown>
  if (self.puuid !== account.puuid) return
  const bindings = readInputBindings(leagueDir)
  const profile: AccountProfile = { profileIconId: number(self.profileIconId), level: number(self.summonerLevel), region: account.platformId, spellKeys: bindings.spellKeys, movementMode: bindings.movementMode, spellBindingVersion: 2, masteryScore: null, mastery: {}, updatedAt: Date.now() }
  try { const mastery = await get('/lol-champion-mastery/v1/local-player/champion-mastery'); if (Array.isArray(mastery)) for (const row of mastery) { const id = number(row.championId); const level = number(row.championLevel); const points = number(row.championPoints); if (id != null && level != null && points != null) profile.mastery[String(id)] = { level, points } } } catch { /* Keep profile available if mastery is unsupported. */ }
  try { profile.masteryScore = number(await get('/lol-champion-mastery/v1/local-player/champion-mastery-score')) } catch { /* Optional endpoint. */ }
  try { profile.challenges = readOwnedChallenges(await get('/lol-challenges/v1/challenges/local-player')) } catch { try { profile.challenges = JSON.parse(db.getSetting(`profile:${accountId}`) ?? '{}').challenges } catch { /* Keep other profile fields available. */ } }
  if (offline() || db.getSetting('activeAccountId') !== accountId) return
  db.setSetting(`profile:${accountId}`, JSON.stringify(profile))
}
function number(v: unknown): number | null { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null }
export function readSpellKeys(leagueDir: string): [string | null, string | null] {
  return readInputBindings(leagueDir).spellKeys
}
