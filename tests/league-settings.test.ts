import { describe, expect, it, vi } from 'vitest'
import type { ApiResult, Bootstrap } from '../src/shared/bridge'
import { saveLeagueDirectory } from '../src/renderer/src/league-settings'

const boot: Bootstrap = {
  mode: 'real', offline: false, realClientVerified: true, locale: 'zh-CN', timeZone: 'UTC',
  imageDownloads: 'auto', leagueDir: 'D:/Games/League of Legends', storagePath: '', logPath: '',
  activeAccountId: null, accounts: [], discovery: { state: 'found', port: 50000 },
  schemaBlocked: null, recoveryPath: null, hasCachedMatches: false
}
const settings = { locale: boot.locale, timeZone: boot.timeZone, offline: false, imageDownloads: boot.imageDownloads, leagueDir: boot.leagueDir }
describe('saving the League directory', () => {
  it('saves the new directory before connecting, and returns the newly connected account without a reload', async () => {
    let persisted = false
    const connected = { ...boot, activeAccountId: 'new-account', accounts: [{ accountId: 'new-account', alias: 'Poro' }] }
    const updateSettings = vi.fn(async () => { persisted = true; return { ok: true as const, data: boot } })
    const connectLeague = vi.fn(async () => { expect(persisted).toBe(true); return { ok: true as const, data: connected } })
    expect(await saveLeagueDirectory({ updateSettings, connectLeague }, settings)).toEqual({ok: true, data: connected})
    expect(updateSettings).toHaveBeenCalledWith(settings)
    expect(connectLeague).toHaveBeenCalledTimes(1)
  })
  it('does not connect after a failed save', async () => {
    const failed: ApiResult<Bootstrap> = {ok: false, error: {code: 'invalid', message: 'invalid', retryable: false, correlationId: 'test'}}
    const connectLeague = vi.fn()
    expect(await saveLeagueDirectory({updateSettings: async () => failed, connectLeague}, settings)).toBe(failed)
    expect(connectLeague).not.toHaveBeenCalled()
  })
  it.each([{...boot, offline: true}, {...boot, mode: 'demo' as const}, {...boot, schemaBlocked: {found: 999, supported: 1}}])('preserves offline, demo and schema safeguards', async savedBoot => {
    const connectLeague = vi.fn()
    await saveLeagueDirectory({ updateSettings: async () => ({ok: true, data: savedBoot}), connectLeague }, settings)
    expect(connectLeague).not.toHaveBeenCalled()
  })
  it('returns connection errors instead of claiming a successful import', async () => {
    const failed: ApiResult<Bootstrap> = {ok: false, error: {code: 'client_unavailable', message: '', retryable: true, correlationId: 'test'}}
    expect(await saveLeagueDirectory({updateSettings: async () => ({ok: true, data: boot}), connectLeague: async () => failed}, settings)).toBe(failed)
  })
})
