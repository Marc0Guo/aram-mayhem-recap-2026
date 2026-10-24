import type { ApiResult, AramApi, Bootstrap } from '@shared/bridge'
import type { SettingsInput } from '@shared/schemas'

// Save first so discovery and sync use the newly selected directory.
export async function saveLeagueDirectory(
  api: Pick<AramApi, 'updateSettings' | 'connectLeague'>,
  settings: SettingsInput
): Promise<ApiResult<Bootstrap>> {
  const saved = await api.updateSettings(settings)
  if (!saved.ok || saved.data.mode !== 'real' || saved.data.offline || saved.data.schemaBlocked) return saved
  return api.connectLeague()
}
