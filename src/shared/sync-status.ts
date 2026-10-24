import type { Locale } from './types'

const finished = new Set(['complete', 'partialFailure', 'empty_page', 'repeated_page', 'overlap_stable',
  'cancelled', 'partial_failure', 'budget_entries', 'budget_time', 'capability_forbidden', 'account_changed', 'offline', 'failed'])
export function syncFinished(state: string): boolean { return finished.has(state) }

export function syncError(code: string, locale: Locale): string {
  const messages: Record<string, [string, string]> = {
    offline: ['当前为离线模式，请关闭离线模式后再同步。', 'Turn off offline mode before syncing.'],
    demo: ['演示模式不连接客户端，请切换到真实数据。', 'Switch to real data to connect to League.'],
    client_unavailable: ['无法连接客户端，请确认英雄联盟已登录，或重新保存游戏目录。', 'League is unavailable. Sign in or save the game directory again.'],
    missing_account: ['请先保存游戏目录并连接账号。', 'Save your League directory and connect your account first.'],
    throttled: ['刷新过于频繁，请等待 30 秒后再试。', 'Please wait 30 seconds before refreshing again.'],
    network: ['无法连接本地服务，请确认启动终端仍在运行。', 'Cannot reach the local server. Check that its terminal is still running.'],
    schema_too_new: ['数据库版本较新，请更新应用后重试。', 'Update the app to read this database version.']
  }
  return (messages[code] ?? ['同步请求失败，请稍后重试。', 'Sync request failed. Please try again.'])[locale === 'zh-CN' ? 0 : 1]
}

export function syncStateLabel(state: string, locale: Locale): string {
  const messages: Record<string, [string, string]> = {
    identifying: ['正在确认账号', 'Checking account'],
    listing: ['正在扫描对局', 'Scanning match history'],
    fetching: ['正在读取对局', 'Reading matches'],
    committing: ['正在保存对局', 'Saving matches'],
    empty_page: ['扫描完成，已到达可访问历史末尾', 'Scan complete: end of accessible history'],
    overlap_stable: ['刷新完成，最新对局已核对', 'Refresh complete: recent matches checked'],
    complete: ['同步完成', 'Sync complete'],
    repeated_page: ['扫描停止：客户端重复返回同一页', 'Stopped: client returned a repeated page'],
    cancelled: ['同步已取消，已保存的数据保留', 'Sync cancelled. Saved games are kept.'],
    partial_failure: ['部分对局读取失败，可继续同步重试', 'Some matches failed. Continue sync to retry.'],
    partialFailure: ['部分对局读取失败，可继续同步重试', 'Some matches failed. Continue sync to retry.'],
    budget_entries: ['已到达本轮读取上限，可继续同步', 'Run limit reached. Continue sync to keep importing.'],
    budget_time: ['已到达本轮时间上限，可继续同步', 'Time limit reached. Continue sync to keep importing.'],
    capability_forbidden: ['客户端拒绝访问部分历史', 'The client denied access to this history'],
    account_changed: ['客户端账号已切换，请重新连接', 'League account changed. Reconnect first.'],
    offline: ['已停止：当前为离线模式', 'Stopped: offline mode'],
    failed: ['同步失败，请重试', 'Sync failed. Please try again.']
  }
  return (messages[state] ?? ['正在同步对局', 'Syncing matches'])[locale === 'zh-CN' ? 0 : 1]
}
