import { useRef, useState } from 'react'
import type { Bootstrap, SyncView } from '@shared/bridge'
import { saveLeagueDirectory } from './league-settings'

export function LeagueDirectory({ boot, onBoot }: { boot: Bootstrap; onBoot: (boot: Bootstrap) => void }) {
  const [directory, setDirectory] = useState(boot.leagueDir ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const pending = useRef(false)
  const chinese = boot.locale === 'zh-CN'
  async function save() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setMessage(chinese ? '正在保存并连接客户端…' : 'Saving and connecting to League…')
    try {
      const result = await saveLeagueDirectory(window.aram, {
        locale: boot.locale, timeZone: boot.timeZone, offline: boot.offline,
        imageDownloads: boot.imageDownloads, leagueDir: directory.trim() || null
      })
      if (!result.ok) {
        setMessage(chinese ? '连接失败，请确认客户端已登录后重试。' : 'Connection failed. Sign in to League and try again.')
        return
      }
      onBoot(result.data)
      setMessage(result.data.offline || result.data.mode === 'demo'
        ? (chinese ? '路径已保存；关闭离线模式后可连接客户端。' : 'Directory saved. Turn off offline mode to connect.')
        : result.data.discovery.state === 'found' && result.data.activeAccountId
          ? (chinese ? '已连接，正在同步对局。' : 'Connected. Syncing your matches.')
          : (chinese ? '未找到可用客户端，请确认目录正确且客户端已登录。' : 'League was not found. Check the directory and sign in to the client.'))
    } catch {
      setMessage(chinese ? '连接失败，请稍后重试。' : 'Connection failed. Please try again.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return <section className="league-directory">
    <label>{chinese ? '英雄联盟游戏目录' : 'League of Legends directory'}
      <input type="text" data-testid="league-directory" value={directory} disabled={busy}
        placeholder="D:\Riot Games\League of Legends"
        onChange={event => { setDirectory(event.target.value); setMessage('') }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} />
    </label>
    <p className="note">{chinese ? '选择包含 LeagueClient.exe 的目录。打开客户端并登录后，保存即可开始导入。' : 'Enter the folder containing LeagueClient.exe. Open League and sign in, then save to import.'}</p>
    <button type="button" data-testid="save-league-directory" disabled={busy} aria-busy={busy} onClick={() => void save()}>
      {busy ? (chinese ? '正在连接…' : 'Connecting…') : (chinese ? '保存并连接' : 'Save and connect')}
    </button>
    {message ? <p role="status" data-testid="league-directory-status">{message}</p> : null}
  </section>
}

export function ImportProgress({ progress, locale }: { progress: SyncView; locale: Bootstrap['locale'] }) {
  const chinese = locale === 'zh-CN'
  return <section className="import-progress" data-testid="import-progress" aria-live="polite">
    <h2>{chinese ? '正在导入你的对局' : 'Importing your matches'}</h2>
    <progress aria-label={chinese ? '对局导入进度' : 'Match import progress'} />
    <p>{chinese ? '已发现' : 'Discovered'} {progress.discovered} · {chinese ? '已保存' : 'Saved'} {progress.committed} · {chinese ? '已跳过' : 'Skipped'} {progress.skipped} · {chinese ? '失败' : 'Failed'} {progress.failed}</p>
    <button type="button" onClick={() => void window.aram.syncCancel({runId: progress.runId})}>{chinese ? '取消导入' : 'Cancel import'}</button>
  </section>
}
