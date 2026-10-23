import { anonymousName } from '@shared/privacy'
import { downloadRecapPng } from './export-png'
import { useEffect, useMemo, useState } from 'react'
import type { Bootstrap, IconCatalog, MatchPage, SyncView } from '@shared/bridge'
import { t, type MessageKey } from '@shared/i18n'
import type { DashboardModel, DatePreset, Locale, MatchDetail } from '@shared/types'
import { Recap } from './Recap'

const presets: Array<{ id: DatePreset; label: MessageKey }> = [
  { id: 'last7', label: 'presetLast7' },
  { id: 'last30', label: 'presetLast30' },
  { id: 'lastWeek', label: 'presetLastWeek' },
  { id: 'thisYear', label: 'presetThisYear' },
  { id: 'all', label: 'presetAll' },
  { id: 'custom', label: 'presetCustom' }
]

const noticeKey: Record<string, MessageKey> = {
  'demo-only': 'demoOnlyBanner',
  'client-unavailable': 'clientUnavailable',
  'partial-import': 'partialImport',
  'unverified-import': 'unverifiedImport'
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [preset, setPreset] = useState<DatePreset>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [championId, setChampionId] = useState<number | null>(null)
  const [augmentId, setAugmentId] = useState<string | null>(null)
  const [itemId, setItemId] = useState<number | null>(null)
  const [dash, setDash] = useState<DashboardModel | null>(null)
  const [page, setPage] = useState<MatchPage | null>(null)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [sync, setSync] = useState<SyncView | null>(null)
  const [detail, setDetail] = useState<MatchDetail | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [anonymous, setAnonymous] = useState(() => localStorage.getItem('aram-anonymous') === 'true')
  const [anonymousAlias, setAnonymousAlias] = useState(() => localStorage.getItem('aram-anonymous-alias') ?? '')
  const [includeAlias, setIncludeAlias] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [material, setMaterial] = useState<'glass' | 'solid'>(() => localStorage.getItem('aram-material') === 'solid' ? 'solid' : 'glass')
  const [iconsLoading, setIconsLoading] = useState(false)
  const [icons, setIcons] = useState<IconCatalog | null>(null)

  const locale: Locale = boot?.locale ?? 'zh-CN'
  const text = (key: MessageKey) => t(locale, key)
  const range = useMemo(() => ({
    accountId: boot?.activeAccountId ?? '',
    preset,
    customStart: preset === 'custom' && customStart ? customStart : null,
    customEnd: preset === 'custom' && customEnd ? customEnd : null,
    timeZone: boot?.timeZone ?? 'UTC',
    locale,
    championId,
    augmentId,
    itemId
  }), [boot, preset, customStart, customEnd, locale, championId, augmentId, itemId])

  async function refresh(nextBoot: Bootstrap, nextCursor: string | null) {
    if (!nextBoot.activeAccountId) return
    const query = { ...range, accountId: nextBoot.activeAccountId, locale: nextBoot.locale, timeZone: nextBoot.timeZone }
    const [dashboard, matches] = await Promise.all([
      window.aram.dashboardQuery(query),
      window.aram.matchesList({ ...query, cursor: nextCursor })
    ])
    if (dashboard.ok) setDash(dashboard.data)
    if (matches.ok) setPage(matches.data)
  }

  useEffect(() => { document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en' }, [locale])

  useEffect(() => {
    if (!window.aram) return
    void window.aram.bootstrap().then((result) => {
      if (result.ok) setBoot(result.data)
    })
    return window.aram.onSyncProgress((progress) => {
      const finished = progress.state === 'complete' || progress.state === 'partialFailure' || progress.state === 'empty_page' || progress.state === 'repeated_page' || progress.state === 'overlap_stable' || progress.state === 'cancelled' || progress.state === 'partial_failure' || progress.state === 'budget_entries' || progress.state === 'budget_time' || progress.state === 'capability_forbidden' || progress.state === 'account_changed'
      setSync(finished || progress.runId === 'players' ? null : progress)
      setBoot((current) => {
        if (current && (finished || progress.state === 'committing' || progress.state === 'complete' || progress.state === 'partialFailure')) {
          void refresh(current, cursors.at(-1) ?? null)
        }
        return current
      })
    })
  }, [])

  useEffect(() => {
    if (boot?.activeAccountId) void refresh(boot, null)
  }, [boot?.activeAccountId, boot?.locale, boot?.timeZone, preset, customStart, customEnd, championId, augmentId, itemId])

  useEffect(() => {
    if (!boot || !dash || boot.mode !== 'real') {
      setIcons(null)
      setIconsLoading(false)
      return
    }
    setIconsLoading(true)
    const championIds = [...new Set([
      ...dash.champions.map((row) => row.championId),
      ...dash.poster.cards.flatMap((card) => card.championId == null ? [] : [card.championId]),
      ...dash.poster.playedWith.flatMap((row) => row.championId == null ? [] : [row.championId]),
      ...(page?.matches ?? []).flatMap((match) => match.championId == null ? [] : [match.championId])
    ])].slice(0, 200)
    const itemIds = dash.items.rows.map((row) => row.itemId)
    const augmentIds = dash.augments.rows.map((row) => row.augmentId)
    let cancel = false
    const profileIconIds = [...new Set([dash.profile?.profileIconId, ...dash.poster.playedWith.map(row => row.profileIconId)].filter((id): id is number => id != null))].slice(0,24)
    if (profileIconIds.length) void window.aram.icons({ locale: boot.locale, championIds: [], itemIds: [], augmentIds: [], profileIconIds }).then(result => { if (!cancel && result.ok) setIcons(previous => ({ champions: previous?.champions ?? {}, items: previous?.items ?? {}, augments: previous?.augments ?? {}, profileIcons: { ...previous?.profileIcons, ...result.data.profileIcons } })) })
    // Publish the visible artwork first instead of waiting for the entire roster.
    void (async () => {
      const chunks = Math.max(Math.ceil(championIds.length / 12), Math.ceil(itemIds.length / 12), Math.ceil(augmentIds.length / 12))
      for (let index = 0; index < chunks && !cancel; index += 1) {
        const result = await window.aram.icons({ locale: boot.locale, championIds: championIds.slice(index * 12, index * 12 + 12), itemIds: itemIds.slice(index * 12, index * 12 + 12), augmentIds: augmentIds.slice(index * 12, index * 12 + 12) })
        if (!cancel && result.ok) setIcons((previous) => ({ profileIcons: previous?.profileIcons, champions: { ...previous?.champions, ...result.data.champions }, items: { ...previous?.items, ...result.data.items }, augments: { ...previous?.augments, ...result.data.augments } }))
      }
    })().finally(() => { if (!cancel) setIconsLoading(false) })
    return () => { cancel = true }
  }, [boot, dash, page])

  async function exportPng() {
    if (!boot?.activeAccountId || !dash || dash.locale !== locale || iconsLoading || exporting) return
    setExporting(true)
    setExportMessage('')
    try {
      if (anonymous || location.protocol === 'http:' || location.protocol === 'https:') {
        const filename = await downloadRecapPng({ title: anonymous ? '' : title, includeAlias: anonymous || includeAlias })
        setExportMessage(`${text('exportSaved')} ${filename}`)
      } else {
        const result = await window.aram.exportPng({ ...range, accountId: boot.activeAccountId, title: title || text('storyTitle'), includeAlias })
        if (!result.ok) throw new Error(result.error.code === 'disk_full' ? text('diskFull') : result.error.message)
        setExportMessage(result.data.canceled ? text('exportCanceled') : result.data.path ?? text('exportSaved'))
      }
    } catch {
      setExportMessage(locale === 'zh-CN' ? '导出失败，请等待图片加载完成后重试。' : 'Export failed. Wait for images to load, then try again.')
    } finally { setExporting(false) }
  }

  if (!boot) return <main className="shell"><p>{text('loading')}</p></main>
  if (boot.schemaBlocked) return <main className="welcome"><h1>{text('schemaTooNew')}</h1></main>
  if (boot.recoveryPath) {
    return (
      <main className="welcome">
        <h1>{text('corruption')}</h1>
        <p>{boot.recoveryPath}</p>
      </main>
    )
  }
  if (!boot.activeAccountId && boot.mode === 'real' && !boot.hasCachedMatches) return <Welcome boot={boot} onChange={setBoot} />

  const realAlias = dash?.accountAlias ?? boot.accounts.find((account) => account.accountId === boot.activeAccountId)?.alias ?? ''
  const alias = anonymous ? anonymousName(anonymousAlias, locale) : realAlias
  return (
    <main className="shell" data-material={material}>
      <article className="poster">
        <header className="poster-tools">
          <nav className="toolbar" aria-label={text('inclusiveDates')}>
            {presets.map((item) => <button key={item.id} type="button" data-testid={`preset-${item.id}`} aria-pressed={preset === item.id} onClick={() => { setPreset(item.id); setCursors([null]) }}>{text(item.label)}</button>)}
            {preset === 'custom' ? <><input data-testid="custom-start" aria-label={text('customStart')} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /><input data-testid="custom-end" aria-label={text('customEnd')} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></> : null}
            <span className="range-label">{text('lastScan')}: {dash?.lastScanLabel ?? text('neverScanned')}</span>
          </nav>
          <div className="actions">
            <button type="button" aria-pressed={material === 'glass'} onClick={() => { const next = material === 'glass' ? 'solid' : 'glass'; setMaterial(next); localStorage.setItem('aram-material', next) }}>{locale === 'zh-CN' ? (material === 'glass' ? '玻璃' : '实色') : (material === 'glass' ? 'Glass' : 'Solid')}</button>
            <select aria-label={text('locale')} data-testid="language-switch" value={locale} onChange={(event) => { setIcons(null); void window.aram.updateSettings({ locale: event.target.value as Locale, timeZone: boot.timeZone, offline: boot.offline, imageDownloads: boot.imageDownloads, leagueDir: boot.leagueDir }).then((result) => { if (result.ok) setBoot(result.data) }) }}><option value="zh-CN">简体中文</option><option value="en">English</option></select>
            <button type="button" onClick={() => setSettingsOpen(true)}>{text('settings')}</button>
            <button type="button" className="primary" onClick={() => void exportPng()} data-testid="export" disabled={exporting || iconsLoading || !dash || dash.locale !== locale} aria-busy={exporting}>{exporting ? (locale === 'zh-CN' ? '正在导出…' : 'Exporting…') : text('exportPng')}</button>
          </div>
        </header>
        {exportMessage ? <p className="export-status" role="status">{exportMessage}</p> : null}
        {dash?.notices.filter((notice) => notice !== 'client-unavailable').map((notice) => <p key={notice} className="notice" data-testid={`notice-${notice}`}>{text(noticeKey[notice] ?? 'coverageLimited')}</p>)}
        {sync ? <p className="notice" role="status">{text('updating')} {text('discovered')} {sync.discovered} · {text('saved')} {sync.committed} · {text('skipped')} {sync.skipped} · {text('failed')} {sync.failed} <button type="button" onClick={() => void window.aram.syncCancel({ runId: sync.runId })}>{text('cancel')}</button></p> : null}
        {(championId != null || augmentId || itemId != null) ? (
          <div className="chips">
            {championId != null ? <button className="chip" type="button" onClick={() => setChampionId(null)}>{text('filterChampion')} {text('removeFilter')}</button> : null}
            {augmentId ? <button className="chip" type="button" onClick={() => setAugmentId(null)}>{augmentId}</button> : null}
            {itemId != null ? <button className="chip" type="button" onClick={() => setItemId(null)}>{text('filterItem')} {itemId}</button> : null}
            <button type="button" onClick={() => { setChampionId(null); setAugmentId(null); setItemId(null) }}>{text('resetFilters')}</button>
          </div>
        ) : null}
        <Recap
          dash={dash}
          matches={page?.matches ?? []}
          locale={locale}
          alias={alias}
          anonymous={anonymous}
          badge={dash?.mode === 'demo' ? text('badgeDemo') : text('badgeLocal')}
          demo={dash?.mode === 'demo'}
          icons={icons}
          onChampion={setChampionId}
          onAugment={setAugmentId}
          onItem={setItemId}
          onOpen={(match) => {
            void window.aram.matchDetail({ accountId: boot.activeAccountId ?? '', platformId: match.platformId, gameId: match.gameId, locale, timeZone: boot.timeZone }).then((result) => {
              if (result.ok) setDetail(result.data)
            })
          }}
        />

      </article>
      {detail ? <aside className="drawer" role="dialog" aria-label={text('drawerTitle')}><button type="button" onClick={() => setDetail(null)}>{text('close')}</button><h2>{icons?.champions[String(detail.championId)]?.name || detail.championName}</h2><p>{detail.startLabel}</p><p>{detail.resultLabel} · {detail.durationLabel}</p><p>{detail.kdaLabel} · {detail.damageLabel}</p><p>{detail.augments.map((augment) => icons?.augments[augment.augmentId]?.name || augment.augmentId).join(' / ') || text('augmentUnavailable')}</p></aside> : null}
      {settingsOpen ? <Settings anonymous={anonymous} setAnonymous={(value) => {setAnonymous(value);localStorage.setItem('aram-anonymous',String(value));setExportMessage('')}} anonymousAlias={anonymousAlias} setAnonymousAlias={(value) => {setAnonymousAlias(value);localStorage.setItem('aram-anonymous-alias',value);setExportMessage('')}} boot={boot} title={title} setTitle={setTitle} includeAlias={includeAlias} setIncludeAlias={setIncludeAlias} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} onClose={() => setSettingsOpen(false)} onBoot={setBoot} exportMessage={exportMessage} /> : null}
    </main>
  )
}

function Welcome({ boot, onChange }: { boot: Bootstrap; onChange: (boot: Bootstrap) => void }) {
  const text = (key: MessageKey) => t(boot.locale, key)
  return (
    <main className="welcome">
      <h1>{text('welcomeTitle')}</h1>
      <p>{text('welcomeBody')}</p>
      <div className="actions">
        <button className="primary" type="button" onClick={() => void window.aram.connectLeague().then((result) => { if (result.ok) onChange(result.data) })}>{text('connect')}</button>
        <button type="button" onClick={() => void window.aram.useDemo().then((result) => { if (result.ok) onChange(result.data) })}>{text('tryDemo')}</button>
      </div>
      {boot.discovery.state !== 'found' && boot.discovery.state !== 'pending' && boot.discovery.state !== 'skipped' ? <p>{text('discoveryMissing')} <button type="button" onClick={() => void window.aram.openLeague()}>{text('openLeague')}</button> <button type="button" onClick={() => void window.aram.retryDiscovery()}>{text('retry')}</button></p> : null}
    </main>
  )
}

function Settings(props: {
  anonymous: boolean
  setAnonymous: (value:boolean)=>void
  anonymousAlias: string
  setAnonymousAlias: (value:string)=>void
  boot: Bootstrap
  title: string
  setTitle: (value: string) => void
  includeAlias: boolean
  setIncludeAlias: (value: boolean) => void
  confirmDelete: boolean
  setConfirmDelete: (value: boolean) => void
  onClose: () => void
  onBoot: (boot: Bootstrap) => void
  exportMessage: string
}) {
  const { boot, onBoot, onClose } = props
  const text = (key: MessageKey) => t(boot.locale, key)
  const [offline, setOffline] = useState(boot.offline)
  const [downloads, setDownloads] = useState(boot.imageDownloads)
  const [leagueDir, setLeagueDir] = useState(boot.leagueDir ?? '')
  const [timeZone, setTimeZone] = useState(boot.timeZone)
  const save = (patch: Partial<{ locale: Locale; timeZone: string; offline: boolean; imageDownloads: 'auto' | 'never'; leagueDir: string }>) => {
    void window.aram.updateSettings({
      locale: patch.locale ?? boot.locale,
      timeZone: patch.timeZone ?? timeZone,
      offline: patch.offline ?? offline,
      imageDownloads: patch.imageDownloads ?? downloads,
      leagueDir: (patch.leagueDir ?? leagueDir).trim() || null
    }).then((result) => { if (result.ok) onBoot(result.data) })
  }
  return (
    <dialog open aria-label={text('settingsTitle')}>
      <h2>{text('settingsTitle')}</h2>
      <label><input data-testid="anonymous-toggle" type="checkbox" checked={props.anonymous} onChange={event=>props.setAnonymous(event.target.checked)} />{boot.locale==='zh-CN'?'匿名模式（页面与 PNG）':'Anonymous mode (dashboard and PNG)'}</label>
      {props.anonymous ? <label>{boot.locale==='zh-CN'?'匿名昵称':'Anonymous name'}<input data-testid="anonymous-name" maxLength={32} value={props.anonymousAlias} placeholder={boot.locale==='zh-CN'?'召唤师':'Summoner'} onChange={event=>props.setAnonymousAlias(event.target.value)} /></label> : null}
      <label>{text('locale')}<select value={boot.locale} onChange={(event) => save({ locale: event.target.value as Locale })}><option value="zh-CN">{text('chinese')}</option><option value="en">{text('english')}</option></select></label>
      <label>{text('timezone')}<input type="text" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} onBlur={() => save({ timeZone })} /></label>
      <label><input type="checkbox" checked={offline} onChange={(event) => { setOffline(event.target.checked); save({ offline: event.target.checked }) }} /> {text('offline')}</label>
      <p className="note">{text('offlineHelp')}</p>
      <label>{text('imageDownloads')}<select value={downloads} onChange={(event) => { const imageDownloads = event.target.value === 'never' ? 'never' : 'auto'; setDownloads(imageDownloads); save({ imageDownloads }) }}><option value="auto">{text('imageAuto')}</option><option value="never">{text('imageNever')}</option></select></label>
      <label>{text('leagueFolder')}<input data-testid="league-directory" value={leagueDir} placeholder="C:\Riot Games\League of Legends" onChange={event=>setLeagueDir(event.target.value)} onBlur={()=>save({leagueDir})} /></label>
      <button type="button" onClick={()=>save({leagueDir})}>{boot.locale==='zh-CN'?'保存游戏目录':'Save League directory'}</button>
      <p>{text('storagePath')}: {boot.storagePath} <button type="button" onClick={() => void window.aram.openLocation('data')}>{text('openFolder')}</button></p>
      <p>{text('logPath')}: {boot.logPath} <button type="button" onClick={() => void window.aram.openLocation('logs')}>{text('openFolder')}</button></p>
      <p><button type="button" onClick={() => boot.activeAccountId && void window.aram.syncStart({ accountId: boot.activeAccountId, kind: 'manual' })}>{text('refresh')}</button> <button type="button" onClick={() => boot.activeAccountId && void window.aram.syncStart({ accountId: boot.activeAccountId, kind: 'continue' })}>{text('continueSync')}</button> <button type="button" onClick={() => boot.activeAccountId && void window.aram.syncStart({ accountId: boot.activeAccountId, kind: 'rebuild' })}>{text('rebuild')}</button></p>
      <label>{text('exportTitle')}<input type="text" value={props.title} onChange={(event) => props.setTitle(event.target.value)} /></label>
      <label><input type="checkbox" checked={props.includeAlias} onChange={(event) => props.setIncludeAlias(event.target.checked)} /> {text('includeAlias')}</label>
      {props.exportMessage ? <p>{props.exportMessage}</p> : null}
      <label><input type="checkbox" checked={props.confirmDelete} onChange={(event) => props.setConfirmDelete(event.target.checked)} /> {text('deleteConfirmCheck')}</label>
      <button type="button" disabled={!props.confirmDelete || !boot.activeAccountId} onClick={() => boot.activeAccountId && void window.aram.deleteAccount({ accountId: boot.activeAccountId, confirmed: true }).then((result) => { if (result.ok) { props.setConfirmDelete(false); onBoot(result.data) } })}>{text('confirmDelete')}</button>
      <div className="actions"><button type="button" onClick={onClose}>{text('close')}</button></div>
    </dialog>
  )
}
