import { useRef, useState } from 'react'
import type { Bootstrap, SyncView } from '@shared/bridge'
import { syncError, syncFinished, syncStateLabel } from '@shared/sync-status'
import { t } from '@shared/i18n'

type Kind = 'manual' | 'continue' | 'rebuild'
export function SyncControls({ boot, progress }: { boot: Bootstrap; progress: SyncView | null }) {
  const [pending, setPending] = useState(false)
  const [waitingRun, setWaitingRun] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [cancellingRun, setCancellingRun] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const chinese = boot.locale === 'zh-CN'
  const current = progress?.accountId === boot.activeAccountId ? progress : null
  const running = !!current && !syncFinished(current.state)
  const waiting = !!waitingRun && current?.runId !== waitingRun
  const unavailable = boot.mode === 'demo' ? 'demo' : boot.offline ? 'offline' : !boot.activeAccountId ? 'missing_account' : ''
  async function start(kind: Kind) {
    if (pendingRef.current || running || waiting || unavailable) return
    pendingRef.current = true
    setPending(true)
    setError('')
    setCancellingRun(null)
    try {
      const result = await window.aram.syncStart({ accountId: boot.activeAccountId, kind })
      if (result.ok) setWaitingRun(result.data.runId)
      else setError(syncError(result.error.code, boot.locale))
    } catch { setError(syncError('network', boot.locale)) }
    finally { pendingRef.current = false; setPending(false) }
  }
  async function cancel() {
    if (!current) return
    setCancellingRun(current.runId)
    try {
      const result = await window.aram.syncCancel({ runId: current.runId })
      if (!result.ok) { setError(syncError(result.error.code, boot.locale)); setCancellingRun(null) }
    } catch { setError(syncError('network', boot.locale)); setCancellingRun(null) }
  }
  return <section className="sync-controls" data-testid="sync-controls">
    <div className="actions">{(['manual', 'continue', 'rebuild'] as const).map(kind =>
      <button key={kind} type="button" data-testid={'sync-' + kind}
        disabled={pending || waiting || running || !!unavailable} onClick={() => void start(kind)}>
        {t(boot.locale, kind === 'manual' ? 'refresh' : kind === 'continue' ? 'continueSync' : 'rebuild')}
      </button>)}</div>
    <p className="note">{chinese
      ? '刷新：检查最新对局；继续同步：接着未完成的位置读取；重建可访问历史：从最新一页重新扫描并校验已保存对局。'
      : 'Refresh checks recent games. Continue resumes an unfinished scan. Rebuild scans from the newest page and revalidates saved games.'}</p>
    {unavailable ? <p role="status">{syncError(unavailable, boot.locale)}</p> : null}
    {error ? <p role="alert" data-testid="sync-error">{error}</p> : null}
    {pending || waiting ? <p role="status">{chinese ? '正在启动同步…' : 'Starting sync…'}</p> : null}
    {current && !pending && !waiting ? <div role="status" data-testid="sync-result">
      <p>{syncStateLabel(current.state, boot.locale)}</p>
      {running ? <p className="note">{chinese ? '同步进行中，请等待完成，或先取消后选择其他操作。' : 'A sync is running. Wait for it to finish, or cancel before choosing another action.'}</p> : null}
      {running ? <progress aria-label={chinese ? '对局同步进度' : 'Match sync progress'} /> : null}
      <p>{chinese ? '已发现' : 'Discovered'} {current.discovered} · {chinese ? '已写入' : 'Written'} {current.committed} · {chinese ? '已跳过' : 'Skipped'} {current.skipped} · {chinese ? '失败' : 'Failed'} {current.failed}</p>
      {running ? <button type="button" disabled={cancellingRun === current.runId} onClick={() => void cancel()}>{cancellingRun === current.runId ? (chinese ? '正在取消…' : 'Cancelling…') : (chinese ? '取消同步' : 'Cancel sync')}</button> : null}
    </div> : null}
  </section>
}
