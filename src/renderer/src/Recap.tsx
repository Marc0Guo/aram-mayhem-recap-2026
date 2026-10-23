import { friendName } from '@shared/privacy'
import challengeCatalog from '@shared/challenge-catalog.json'
import championNames from '@shared/champion-names.json'
import itemNames from '@shared/item-names.json'
import augmentCatalog from '@shared/augment-catalog.json'
import type { IconCatalog } from '@shared/bridge'
import type { MessageKey } from '@shared/i18n'
import { t } from '@shared/i18n'
import type { PosterCardKey } from '@shared/match-facts'
import type { ActivityDay, DashboardModel, Locale, MatchSummary } from '@shared/types'

const roleIcons = import.meta.glob<string>('./assets/roles/*.png', { eager: true, query: '?url', import: 'default' })
const challengeIcons = import.meta.glob<string>('./assets/challenges/*.png', { eager: true, query: '?url', import: 'default' })

const masteryCrests = import.meta.glob<string>('./assets/mastery/*.png', { eager: true, query: '?url', import: 'default' })

const bundledAugments = import.meta.glob<string>('./assets/augments/*.png', { eager: true, query: '?url', import: 'default' })

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

interface Look {
  cloth: string
  skin: string
  hair: string
  glow: string
}

const LOOKS: Record<number, Look> = {
  157: { cloth: '#1d4e89', skin: '#f0c9a0', hair: '#e7f3ff', glow: '#7eb6ff' },
  222: { cloth: '#6a1860', skin: '#f3c6aa', hair: '#7cefff', glow: '#ff4fa3' },
  81: { cloth: '#0e6a62', skin: '#e8b890', hair: '#ffe7a3', glow: '#f0c14a' },
  51: { cloth: '#3a215c', skin: '#f0cbb0', hair: '#d2b0ff', glow: '#b388ff' }
}

const FALLBACK_LOOK: Look = { cloth: '#1a3a5c', skin: '#e6c2a2', hair: '#f0d48a', glow: '#d4b36a' }

const CLASS_ORDER = ['Tank', 'Fighter', 'Assassin', 'Mage', 'Marksman', 'Support'] as const
const CLASS_LABEL: Record<(typeof CLASS_ORDER)[number], MessageKey> = {
  Tank: 'classTank',
  Fighter: 'classFighter',
  Assassin: 'classAssassin',
  Mage: 'classMage',
  Marksman: 'classMarksman',
  Support: 'classSupport'
}
const CARD_LABEL: Record<PosterCardKey, MessageKey> = {
  mostKills: 'mostKills',
  mostDeaths: 'mostDeaths',
  mostAssists: 'mostAssists',
  damageDealt: 'damageDealt',
  largestCrit: 'largestCrit',
  damageTaken: 'damageTaken',
  killsPerMin: 'killsPerMin',
  deathsPerMin: 'deathsPerMin',
  assistsPerMin: 'assistsPerMin',
  damagePerMin: 'damagePerMin',
  longestGame: 'longestGame',
  bestKda: 'bestKda'
}

export function Recap(props: {
  dash: DashboardModel | null
  matches: MatchSummary[]
  locale: Locale
  anonymous?: boolean
  alias: string
  badge: string
  demo: boolean
  icons?: IconCatalog | null
  onChampion: (championId: number) => void
  onAugment: (augmentId: string) => void
  onItem: (itemId: number) => void
  onOpen: (match: MatchSummary) => void
}) {
  const { dash, matches, locale, alias, badge, demo } = props
  const icons = props.icons ?? null
  const augmentName = (id: string, fallback: string) => { const meta = (augmentCatalog as Record<string, { en: string; zh: string; rarity: string }>)[id]; return meta ? (locale === 'zh-CN' ? meta.zh : meta.en) || fallback : fallback }
  const rarityOf = (id: string) => { const rarity = (augmentCatalog as Record<string, { rarity: string }>)[id]?.rarity; return rarity === 'kSilver' ? 'silver' : rarity === 'kGold' ? 'gold' : rarity === 'kPrismatic' ? 'prismatic' : 'unknown' }
  const rarityLabel = (id: string) => { const tier = rarityOf(id); return locale === 'zh-CN' ? ({ silver: '银色', gold: '金色', prismatic: '彩色', unknown: '未分级' })[tier] : ({ silver: 'Silver', gold: 'Gold', prismatic: 'Prismatic', unknown: 'Unclassified' })[tier] }
  const profile = dash?.profile
  const flashSlot = dash?.poster.flashSlot
  const flashKey = flashSlot ? profile?.spellKeys[flashSlot - 1] : null
  const text = (key: MessageKey) => t(locale, key)
  const classes = classShare(dash, icons)
  const playedWith = dash?.poster.playedWith ?? []
  const year = heatmapYear(dash?.activity ?? [], dash?.rangeLabel)
  const weeks = yearWeeks(year, dash?.activity ?? [])

  const busiest = (dash?.activity ?? []).reduce<ActivityDay | null>((bestDay, day) => {
    if (day.games <= 0) return bestDay
    if (!bestDay || day.games > bestDay.games) return day
    return bestDay
  }, null)
  const maxClassGames = Math.max(1, ...classes.map((row) => row.games))
  const cards = (dash?.poster.cards ?? []).map((card) => ({
    key: card.key,
    label: text(CARD_LABEL[card.key]),
    value: card.value,
    kills: card.kills, deaths: card.deaths, assists: card.assists, duration: card.durationText,
    championId: card.championId,
    sub: card.durationText ?? '—'
  }))

  return (
    <div className="recap">
      <section className="statband">
        <h1 className="recap-title">{recapTitle(alias, dash?.rangeLabel, locale)}</h1>
        <div className="identity">
          <ProfileAvatar iconId={profile?.profileIconId ?? null} icons={icons} label={alias} />
          <strong data-testid="account-alias">{alias}</strong>
          <span className={demo ? 'badge demo' : 'badge'} data-testid="mode-badge">{badge}</span>
          <em>lv. {profile?.level ?? '—'} {profile?.region ?? ''}</em>
          {flashKey ? <em className="flash-key"><b>{flashKey}</b> {locale === 'zh-CN' ? '键闪现' : 'is for Flash'}</em> : null}
        </div>
        <div className="stat-grid reference-stats">
          {summaryCells(dash,locale).map(cell=><article className="stat" key={cell.key}><h2>{cell.label}</h2><div className="stat-line"><b data-testid={cell.key==='games'?'hero-games':undefined}>{cell.value}</b><span>{cell.detail}</span></div></article>)}
        </div>
        <div className="heat-panel"><div className="heat-legend"><span className="heat-scale">{['0','1','3','5','7','15','>30'].map((label,index)=><span key={label}>{label}<i className={index===0?'heat-cell':`heat-cell on${index}`} /></span>)}</span><span>{busiest ? `${busiest.date} · ${busiest.games}` : "—"}</span></div>
          <div className="heat-wrap">
            <div className="heat-days" aria-hidden="true">
              {(locale === 'zh-CN' ? ['日', '一', '二', '三', '四', '五', '六'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
            </div>
            <div className="heat" aria-hidden="true">
            {weeks.map((column) => (
              <div className="heat-col" key={column[0]?.date ?? 'empty'}>
                {column.map((day) => (
                  <i key={day.date} className={heatClass(day.games)} title={day.games < 0 ? undefined : `${day.date} ${Math.max(0, day.games)}`} />
                ))}
              </div>
            ))}
            </div>
          </div>
          <div className="heat-months" aria-hidden="true">
            {(locale === 'zh-CN' ? MONTHS_ZH : MONTHS_EN).map((name) => <span key={name}>{name}</span>)}
          </div>

        </div>
      </section>

      <h2 className="section-title">{text('recapHighlights')}</h2>
      <section className="highlights" data-testid="match-highlights">
        {cards.map((item) => {
          const face = faceOf(icons, item.championId)
          const splash = safeAsset(face?.splash)
          return (
            <article className={splash ? 'hl has-art' : 'hl'} key={item.key} style={splash ? undefined : { background: `radial-gradient(circle at 50% 42%, ${glowOf(item.championId)}88, rgba(8, 22, 44, 0.15) 72%)` }}>
              {splash ? <img className="hl-splash" src={splash} alt="" /> : <Portrait championId={item.championId} seed={`hl-${item.key}`} art={safeAsset(face?.portrait)} />}
              <small>{item.label}</small>
              {(['mostKills','mostDeaths','mostAssists'] as string[]).includes(item.key) ? <div className="hl-kda">{[item.kills,item.deaths,item.assists].map((value,index)=><span className={index === (item.key === 'mostKills' ? 0 : item.key === 'mostDeaths' ? 1 : 2) ? 'highlight-value' : ''} key={index}>{index ? <i> / </i> : null}{value ?? '—'}</span>)}</div> : <div className="hl-number"><b>{item.value}{item.key === 'bestKda' && item.value !== '—' && item.value !== text('perfect') ? ':1' : ''}</b><em>{highlightUnit(item.key,locale)}</em></div>}
              <span className="hl-detail">{highlightDetail(item,locale)}</span>
            </article>
          )
        })}
      </section>

      <section className="lower">
        <div className="panel-block champions-block"><h2 className="section-title">{text('mostPlayed')}</h2><article className="panel">
          <div data-testid="champion-summary">
            <div className="champ-podium">
              {dash?.champions.slice(0, 3).map((row, index) => { const mastery = profile?.mastery[String(row.championId)]; const multi = dash.poster.championExtras?.[String(row.championId)]; return <button type="button" title={localName(championNames, row.championId, locale, row.name)} aria-label={localName(championNames, row.championId, locale, row.name)} className={`podium-player podium-${index}`} key={row.championId} onClick={() => props.onChampion(row.championId)}>
                <span className="podium-rank">#{index + 1}</span><Portrait championId={row.championId} seed={`podium-${row.championId}`} art={safeAsset(faceOf(icons, row.championId)?.portrait)} />
                <MasteryCrest level={mastery?.level} />
                <span className="mastery-level">lv. {mastery?.level ?? '—'}</span>
                <span className="mastery-points">{pointsLabel(mastery?.points, locale)}</span>
                <span><b>{row.games}</b> {text('gamesUnit')} {row.winRate == null ? '—' : `${row.winRate.toFixed(0)}%`} WR</span>
                <span className="multikills">{locale==='zh-CN'?'五杀':'PK'} {multi?.penta ?? '—'} {locale==='zh-CN'?'四杀':'QK'} {multi?.quadra ?? '—'} {locale==='zh-CN'?'三杀':'TK'} {multi?.triple ?? '—'}</span>
                <span>{row.perfect ? row.kdaText : `${row.kdaText}:1`} KDA</span>
              </button> })}
            </div>
            {dash?.champions.slice(3, 10).map((row, index) => { const mastery = profile?.mastery[String(row.championId)]; const multi = dash.poster.championExtras?.[String(row.championId)]; return <button className="champ-row detailed-champ" type="button" key={row.championId} title={localName(championNames, row.championId, locale, row.name)} aria-label={localName(championNames, row.championId, locale, row.name)} onClick={() => props.onChampion(row.championId)}>
              <span className="champ-row-visual"><span className="rank">#{index + 4}</span>{safeAsset(faceOf(icons,row.championId)?.portrait ?? faceOf(icons,row.championId)?.splash) ? <img src={safeAsset(faceOf(icons,row.championId)?.portrait ?? faceOf(icons,row.championId)?.splash) ?? ''} alt="" /> : <Portrait championId={row.championId} seed={`row-${row.championId}`} />}</span>
              <span>lv. {mastery?.level ?? '—'}</span><MasteryCrest level={mastery?.level} /><span className="mastery-points">{pointsLabel(mastery?.points, locale)}</span>
              <span className="champ-record"><b>{row.games}</b> {text('gamesUnit')}<small>{row.winRate == null ? '—' : `${row.winRate.toFixed(0)}%`} WR</small></span>
              <span className="champ-performance">{row.perfect ? row.kdaText : `${row.kdaText}:1`} KDA<small>{locale==='zh-CN'?'五杀':'PK'} {multi?.penta ?? '—'} {locale==='zh-CN'?'四杀':'QK'} {multi?.quadra ?? '—'} {locale==='zh-CN'?'三杀':'TK'} {multi?.triple ?? '—'}</small></span>
            </button> })}
            <p className="champion-footer">{locale === 'zh-CN' ? `已使用 ${dash?.champions.length ?? 0} / ${Object.keys(championNames).length} 位英雄（${(((dash?.champions.length ?? 0) / Object.keys(championNames).length) * 100).toFixed(1)}%）· 当前总熟练度 ${profile?.masteryScore ?? '—'}` : `Played ${dash?.champions.length ?? 0} / ${Object.keys(championNames).length} champions (${(((dash?.champions.length ?? 0) / Object.keys(championNames).length) * 100).toFixed(1)}%) · Current mastery score ${profile?.masteryScore ?? '—'}`}</p>
            {dash && dash.champions.length === 0 ? <p>{text('noChampionData')}</p> : null}
          </div>
        </article></div>
        <article className="panel loadout-panel">
          <section className="loadout-group"><h2>{text('mostAugments')}</h2>
          {dash?.augments.available ? (
            <div className="rune-grid">
              {dash.augments.rows.slice(0, 12).map((row) => {
                const tile = icons?.augments[row.augmentId]
                const icon = bundledAugments[`./assets/augments/${row.augmentId}.png`] ?? safeAsset(tile?.icon)
                const name = augmentName(row.augmentId, shown(row.name, tile?.name))
                return (
                  <button className={`rune augment-tile rarity-${rarityOf(row.augmentId)}`} type="button" key={row.augmentId} title={`${name} · ${rarityLabel(row.augmentId)}`} onClick={() => props.onAugment(row.augmentId)}>
                    <span className="augment-art" aria-hidden="true">{icon ? <><img src={icon} alt="" /><span className="augment-prism" style={{ maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` }} /></> : <span className="hex-placeholder">⬡</span>}</span>
                    <b className="augment-count">{row.count}</b><span className="augment-name">{name}</span>
                  </button>
                )
              })}
            </div>
          ) : <p data-testid={dash && !dash.augments.available ? 'augment-unavailable' : undefined}>{dash ? text('augmentUnavailable') : '—'}</p>}
          </section><section className="loadout-group"><h2>{text('finalItems')}</h2>
          {dash?.items.available ? (
            <div className="rune-grid">
              {dash.items.rows.filter((row) => row.itemId !== 2052).slice(0, 6).map((row) => {
                const tile = icons?.items[String(row.itemId)]
                return (
                  <button className="rune" type="button" key={row.itemId} title={localName(itemNames, row.itemId, locale, shown(row.name, tile?.name))} onClick={() => props.onItem(row.itemId)}>
                    <ItemMark itemId={row.itemId} icon={safeAsset(tile?.icon)} />
                    <b>{row.count}</b>
                  </button>
                )
              })}
            </div>
          ) : <p>{text('itemsUnavailable')}</p>}
          </section><section className="loadout-group"><h2>{text('championRoles')}</h2>
          <div className="role-board" data-testid="champion-roles">
            {classes.length > 0 ? classes.map((row) => (
              <div className="role-stat" key={row.key}>
                <b>{row.percent.toFixed(0)}%</b>
                <div className="bar-track"><div className="bar-fill" style={{ height: `${row.games === 0 ? 0 : Math.max(8, (row.games / maxClassGames) * 100)}%` }} /></div>
                <img className="role-icon" src={roleIcons[`./assets/roles/${row.key.toLowerCase()}.png`]} alt="" /><span>{text(CLASS_LABEL[row.key])}</span>
              </div>
            )) : dash && dash.champions.length === 0 ? <p>{text('noChampionData')}</p> : null}
          </div></section>
        </article>
        <aside className="panel stack-wrap">
          {(dash?.poster.funCards ?? []).filter(row=>row.value!=='—').map((row, index) => <div className="banner-stat" key={row.label}>
            {safeAsset(faceOf(icons, row.championId ?? dash?.champions[index % Math.max(1, dash.champions.length)]?.championId ?? null)?.splash) ? <img src={safeAsset(faceOf(icons, row.championId ?? dash?.champions[index % Math.max(1, dash.champions.length)]?.championId ?? null)?.splash) ?? ''} alt="" /> : null}
            <small>{row.label}</small><b>{row.value}</b><span>{row.detail}</span>
          </div>)}
        </aside>
      </section>

      <section className="bottom">
        <div className="panel-block"><h2 className="section-title">{text('topChallenges')}</h2><article className="panel" data-testid="top-challenges">
          <div className="challenge-grid">
            {profile?.challenges?.slice(0,12).map(card => { const meta=(challengeCatalog as Record<string,{en:string;zh:string;enHint:string;zhHint:string}>)[card.id]; const tier=challengeIcons[`./assets/challenges/${card.id}-${card.level.toLowerCase()}.png`] ?? challengeIcons[`./assets/challenges/${card.id}.png`]; return <div className="challenge" key={card.id}>{tier ? <img className="challenge-token" src={tier} alt="" /> : null}<span><strong>{locale==='zh-CN'?meta?.zh??card.name:meta?.en??card.name}</strong><span>{(locale==='zh-CN'?meta?.zhHint??card.description:meta?.enHint??card.description).replace(/<[^>]*>/g,'')}</span><span className="challenge-count">{card.value.toLocaleString(locale)} {card.rank ? ` / ${locale==='zh-CN'?'排名':'Rank'} #${card.rank.toLocaleString(locale)}` : ''}</span><span className="challenge-rarity">{challengeLevel(card.level,locale)}{card.percentile == null ? '' : ` · ${locale==='zh-CN'?'前':'Top'} ${Number(card.percentile.toFixed(2))}%`}</span></span></div> })}
            {!profile?.challenges?.length ? dash?.poster.aramChallenges?.filter(card=>card.value!=='—').map(card => <div className="challenge" key={card.id}><img className="challenge-token" src={challengeIcons[`./assets/challenges/${card.id}.png`]} alt="" /><span><strong>{card.name}</strong><span>{card.hint}</span><span className="challenge-count">{card.value}</span></span></div>) : null}
          </div>
        </article></div>
        <div className="panel-block"><h2 className="section-title">{text('playedWith')}</h2><article className="panel" data-testid="played-with">
          {dash?.emptyKind === 'no-matches-in-range' ? <p data-testid="notice-no-matches-in-range">{text('noMatchesInRange')}</p> : null}
          {dash?.emptyKind === 'no-stored-history' ? <p>{text('noStoredHistory')}</p> : null}
          {dash?.emptyKind === 'filtered-empty' ? <p>{text('filteredEmpty')}</p> : null}
          <div className="match-list">
            {playedWith.length > 0 ? playedWith.slice(0, 5).map((row) => (
              <div className="duo" key={row.playerKey}>
                <ProfileAvatar iconId={row.profileIconId ?? null} icons={icons} label={friendName(row.playerId,!!props.anonymous,alias)} />
                <span className="duo-name">{friendName(row.playerId,!!props.anonymous,alias)}<small>{row.games} {text('gamesUnit')}</small></span>
                <span className={row.wins * 2 >= row.games ? 'win' : 'loss'}>{winShare(row.wins, row.games)}</span>
              </div>
            )) : dash && dash.gamesText !== '0' ? <p>{text('playerIdsPending')}</p> : matches.map((match) => (
              <button className="duo" type="button" key={`${match.platformId}-${match.gameId}`} onClick={() => props.onOpen(match)}>
                <Portrait championId={match.championId} seed={`m-${match.gameId}`} art={safeAsset(faceOf(icons, match.championId)?.portrait)} />
                <span className="duo-name">{localName(championNames, match.championId, locale, match.championName)}<small>{match.startLabel}</small></span>
                <span className={match.resultState === 'win' ? 'win' : match.resultState === 'loss' ? 'loss' : ''}>{match.resultLabel}</span>
                <span>{match.kdaLabel}</span>
              </button>
            ))}
          </div>
          {dash?.poster.playedWithPlayerCount != null && dash.poster.playedWithPlayerCount > 0 ? <p className="played-with-footer">{locale === 'zh-CN' ? `共与 ${dash.poster.playedWithPlayerCount.toLocaleString(locale)} 位玩家一起出场` : `Played with ${dash.poster.playedWithPlayerCount.toLocaleString(locale)} players`}</p> : null}
        </article></div>
      </section>
    </div>
  )
}

function ItemMark({ itemId, icon }: { itemId: number; icon?: string | null }) {
  if (icon) return <img className="item-mark photo" src={icon} alt="" />
  const color = ITEM_COLORS[itemId] ?? '#e6c878'
  return (
    <svg className="item-mark" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="3" y="3" width="42" height="42" rx="6" fill={color} stroke="#f6e2a8" strokeWidth="2" />
      <path d={itemShape(itemId)} fill="#1a1408" />
    </svg>
  )
}

function itemShape(itemId: number): string {
  if (itemId === 3031) return 'M24 8l4 14h12l-10 8 4 14-10-8-10 8 4-14-10-8h12z'
  if (itemId === 3072) return 'M24 40s-14-8-14-18a8 8 0 0 1 14-6 8 8 0 0 1 14 6c0 10-14 18-14 18z'
  if (itemId === 3094) return 'M10 34h28l-4-16H14zm6-20h16l-2 8H18z'
  if (itemId === 3006) return 'M8 30h32v6H8zm6-14h6v10h-6zm14 0h6v10h-6z'
  return 'M14 30c0-10 6-16 10-16s10 6 10 16H14z'
}

const ITEM_COLORS: Record<number, string> = {
  1001: '#c9843a',
  3006: '#d24b4b',
  3031: '#e6c14a',
  3072: '#c23b4a',
  3094: '#e07a32'
}

function Portrait({ championId, seed, art, className }: { championId: number | null; seed: string; art?: string | null; className?: string }) {
  if (art) return <img className={className ? `crest photo ${className}` : 'crest photo'} src={art} alt="" />
  const look = (championId != null && LOOKS[championId]) || FALLBACK_LOOK
  const gid = `p-${seed}-${championId ?? 'x'}`.replace(/[^A-Za-z0-9_-]/g, '')
  return (
    <svg className={className ? `crest ${className}` : 'crest'} viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <radialGradient id={gid} cx="40%" cy="32%" r="70%">
          <stop offset="0%" stopColor={look.glow} />
          <stop offset="48%" stopColor={look.cloth} />
          <stop offset="100%" stopColor="#071422" />
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="37.5" fill="#071422" stroke="#e6c878" strokeWidth="2.4" />
      <circle cx="40" cy="40" r="32" fill={`url(#${gid})`} />
      {figure(championId, look)}
      <ellipse cx="28" cy="20" rx="9" ry="4" fill="rgba(255,255,255,.2)" />
    </svg>
  )
}

function figure(championId: number | null, look: Look) {
  if (championId === 222) {
    return (
      <>
        <path d="M16 74c4-18 12-26 24-26s20 8 24 26" fill="#ff4fa3" />
        <circle cx="40" cy="36" r="13" fill={look.skin} />
        <path d="M20 30c8 18 6 34 2 46" stroke="#7cefff" strokeWidth="5" fill="none" />
        <path d="M60 30c-8 18-6 34-2 46" stroke="#7cefff" strokeWidth="5" fill="none" />
        <path d="M27 30c4-12 22-12 26 0c-8-5-18-5-26 0z" fill="#7cefff" />
      </>
    )
  }
  if (championId === 81) {
    return (
      <>
        <path d="M16 74c4-18 12-26 24-26s20 8 24 26" fill={look.cloth} />
        <circle cx="40" cy="36" r="13" fill={look.skin} />
        <path d="M26 32c3-12 8-16 14-16s11 4 14 16c-8-6-20-6-28 0z" fill={look.hair} />
        <circle cx="58" cy="48" r="8" fill="#ffe08a" stroke="#1a1408" strokeWidth="1.5" />
      </>
    )
  }
  if (championId === 51) {
    return (
      <>
        <path d="M18 76c3-16 10-24 22-24s19 8 22 24" fill={look.cloth} />
        <circle cx="40" cy="38" r="12" fill={look.skin} />
        <path d="M22 30c8-16 28-16 36 0v8H22z" fill="#2a1844" />
        <path d="M18 30h44" stroke="#e6c878" strokeWidth="3" />
        <path d="M24 24c6-10 26-10 32 0" fill={look.hair} />
      </>
    )
  }
  return (
    <>
      <path d="M14 74c5-20 14-28 26-28s21 8 26 28" fill={look.cloth} />
      <circle cx="40" cy="36" r="13" fill={look.skin} />
      <path d="M18 40c8-26 36-28 48-4-16-12-34-8-48 4z" fill={look.hair} />
      <path d="M18 58h44" stroke="#e6c878" strokeWidth="2" />
    </>
  )
}


function faceOf(icons: IconCatalog | null, championId: number | null) {
  if (championId == null || !icons) return null
  return icons.champions[String(championId)] ?? null
}

function shown(fallback: string, resolved: string | undefined): string {
  return resolved && resolved.length > 0 ? resolved : fallback
}

function safeAsset(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^\/assets\/[A-Za-z0-9%._/-]+$/.test(url)) return url
  if (!/^wrapped-asset:\/\/local\/[A-Za-z0-9%._/-]+$/.test(url)) return null
  return url
}

function recapTitle(alias: string, _rangeLabel: string | undefined, locale: Locale): string { return locale==='zh-CN' ? `${alias}的海克斯大乱斗年终总结` : `${alias}'s ARAM MAYHEM Recap 2026` }

function percentOnly(value: string | undefined): string {
  if (!value || value === '—') return '—'
  return value.match(/[\d.]+%/)?.[0] ?? value
}

function heatmapYear(days: ActivityDay[], rangeLabel: string | undefined): number {
  const stamped = days.at(-1)?.date ?? days[0]?.date
  if (stamped) return Number(stamped.slice(0, 4))
  const match = rangeLabel?.match(/\d{4}/)
  return match ? Number(match[0]) : new Date().getFullYear()
}

function yearWeeks(year: number, days: ActivityDay[]): Array<Array<{ date: string; games: number }>> {
  const games = new Map(days.map((day) => [day.date, day.games]))
  const january = new Date(Date.UTC(year, 0, 1))
  const start = Date.UTC(year, 0, 1 - january.getUTCDay())
  const weeks: Array<Array<{ date: string; games: number }>> = []
  for (let week = 0; week < 53; week += 1) {
    const column: Array<{ date: string; games: number }> = []
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start + (week * 7 + day) * 86400000)
      const iso = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
      const inYear = date.getUTCFullYear() === year
      column.push({ date: iso, games: inYear ? games.get(iso) ?? 0 : -1 })
    }
    weeks.push(column)
  }
  return weeks
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function heatClass(games: number): string {
  if (games < 0) return 'heat-cell off'
  if (games <= 0) return 'heat-cell'
  if (games > 30) return 'heat-cell on6'
  if (games >= 15) return 'heat-cell on5'
  if (games >= 7) return 'heat-cell on4'
  if (games >= 5) return 'heat-cell on3'
  if (games >= 3) return 'heat-cell on2'
  return 'heat-cell on1'
}

function glowOf(championId: number | null): string {
  return (championId != null && LOOKS[championId]?.glow) || FALLBACK_LOOK.glow
}


function classShare(dash: DashboardModel | null, icons: IconCatalog | null): Array<{ key: (typeof CLASS_ORDER)[number]; games: number; percent: number }> {
  const totals = new Map<(typeof CLASS_ORDER)[number], number>()
  let known = 0
  for (const row of dash?.champions ?? []) {
    const tags = faceOf(icons, row.championId)?.tags ?? []
    const primary = tags.find((tag): tag is (typeof CLASS_ORDER)[number] => (CLASS_ORDER as readonly string[]).includes(tag))
    if (!primary) continue
    known += row.games
    totals.set(primary, (totals.get(primary) ?? 0) + row.games)
  }
  if (known === 0) return []
  const rows = CLASS_ORDER.flatMap((key) => {
    const games = totals.get(key) ?? 0
    if (games === 0) return []
    const exact = (games * 1000) / known
    return [{ key, games, exact, tenths: Math.floor(exact) }]
  })
  let remainder = 1000 - rows.reduce((sum, row) => sum + row.tenths, 0)
  const order = [...rows].sort((left, right) => (right.exact - right.tenths) - (left.exact - left.tenths) || right.games - left.games)
  for (const row of order) {
    if (remainder <= 0) break
    row.tenths += 1
    remainder -= 1
  }
  const sized = rows.map((row) => ({ key: row.key, games: row.games, percent: row.tenths / 10 }))
  return CLASS_ORDER.map((key) => sized.find((row) => row.key === key) ?? { key, games: 0, percent: 0 })
}

function winShare(wins: number, games: number): string {
  if (games <= 0) return '—'
  return `${(Math.round((wins * 1000) / games) / 10).toFixed(1)}%`
}

function localName(catalog: Record<string, { en: string; zh: string }>, id: number | null | undefined, locale: Locale, fallback: string): string { const row = id == null ? null : catalog[String(id)]; return row ? (locale === 'zh-CN' ? row.zh : row.en) || fallback : fallback }

function ProfileAvatar({ iconId, icons, label }: { iconId: number | null; icons: IconCatalog | null; label: string }) { const url = iconId == null ? null : safeAsset(icons?.profileIcons?.[String(iconId)]); return url ? <img className="profile-avatar" src={url} alt={label} /> : <span className="profile-avatar profile-placeholder" role="img" aria-label={label}>?</span> }
function MasteryCrest({ level }: { level: number | undefined }) { if (level == null) return <span className="mastery-crest empty" aria-hidden="true" />; const tier = level >= 10 ? 10 : level >= 4 ? level : 0; return <img className="mastery-crest" src={masteryCrests[`./assets/mastery/${tier}.png`]} alt="" /> }
function pointsLabel(points: number | undefined, locale: Locale): string { return points == null ? '—' : `${(points / 1000).toFixed(1)} K ${locale === 'zh-CN' ? '点' : 'points'}` }

function highlightUnit(key: PosterCardKey, locale: Locale): string { const zh=locale==='zh-CN'; if (['damageDealt','largestCrit','damageTaken'].includes(key)) return zh?'伤害':'dmg'; if(key==='damagePerMin')return zh?'伤害/分钟':'dmg/min'; if(key==='killsPerMin')return zh?'击杀/分钟':'kills/min'; if(key==='deathsPerMin')return zh?'死亡/分钟':'deaths/min'; if(key==='assistsPerMin')return zh?'助攻/分钟':'assists/min'; return key==='bestKda'?'KDA':'' }
function highlightDetail(card: {key:PosterCardKey;kills:number|null;deaths:number|null;assists:number|null;duration:string}, locale:Locale): string { const kda=`${card.kills??'—'} / ${card.deaths??'—'} / ${card.assists??'—'}`; const zh=locale==='zh-CN'; const inTime=card.duration==='—'?'—':zh?card.duration:`in ${card.duration}`; if(card.key==='longestGame'||card.key==='bestKda')return kda; if(card.key==='damageDealt'||card.key==='damagePerMin')return `${kda} ${zh?'· ':''}${inTime}`; if(card.key==='killsPerMin')return `${card.kills??'—'} ${zh?'次击杀 ·':'kills'} ${inTime}`; if(card.key==='deathsPerMin')return `${card.deaths??'—'} ${zh?'次死亡 ·':'deaths'} ${inTime}`; if(card.key==='assistsPerMin')return `${card.assists??'—'} ${zh?'次助攻 ·':'assists'} ${inTime}`; return inTime }

function challengeLevel(level:string,locale:Locale):string { const names:Record<string,string>={IRON:'坚韧黑铁',BRONZE:'英勇黄铜',SILVER:'不屈白银',GOLD:'荣耀黄金',PLATINUM:'华贵铂金',DIAMOND:'璀璨钻石',MASTER:'超凡大师',GRANDMASTER:'傲世宗师',CHALLENGER:'最强王者'};return locale==='zh-CN'?names[level]??level:level.charAt(0)+level.slice(1).toLowerCase() }

function summaryCells(dash:DashboardModel|null,locale:Locale) {
  const zh=locale==='zh-CN',s=dash?.poster.summary
  const n=(v:number|null|undefined)=>v==null?'—':v.toLocaleString(locale,{maximumFractionDigits:0})
  const pct=(v:number|null|undefined)=>v==null?'—':`${(v*100).toFixed(2)}%`
  return [
    {key:'games',label:zh?'总场次':'TOTAL GAMES',value:dash?.gamesText??'—',detail:`${percentOnly(dash?.winRateText)} WR`},
    {key:'time',label:zh?'游戏时长':'TIME PLAYED',value:dash?.playtimeText??'—',detail:''},
    {key:'takedowns',label:zh?'参与击杀':'TOTAL TAKEDOWNS',value:n(s?.takedowns),detail:''},
    {key:'dpm',label:zh?'平均每分钟伤害':'AVERAGE DAMAGE PER MINUTE',value:dash?.metrics.damagePerMin.value==null?'—':dash.metrics.damagePerMin.value.toLocaleString(locale,{maximumFractionDigits:0}),detail:zh?'伤害/分钟':'dmg/min'},
    {key:'kp',label:zh?'参团率':'KILL PARTICIPATION',value:pct(s?.killParticipation),detail:''},
    {key:'damage',label:zh?'总对英雄伤害':'TOTAL DAMAGE DEALT',value:n(s?.totalDamage),detail:zh?'伤害':'dmg'},
    {key:'multi',label:zh?'多重击杀':'MULTIKILLS',value:`${zh?'五杀':'PK'} ${n(s?.penta)} ${zh?'四杀':'QK'} ${n(s?.quadra)} ${zh?'三杀':'TK'} ${n(s?.triple)}`,detail:''},
    {key:'comeback',label:zh?'队伍击杀落后仍获胜':'WINS WITH LESS TEAM KILLS',value:n(s?.winsFewerKills),detail:`/ ${dash?.winsText??'—'} W`},
    {key:'upset',label:zh?'队伍击杀领先仍落败':'LOSSES WITH MORE TEAM KILLS',value:n(s?.lossesMoreKills),detail:`/ ${dash?.lossesText??'—'} L`},
    {key:'streak',label:zh?'最长连胜 / 连败':'WIN / LOSE STREAK',value:`${n(s?.winStreak)} / ${n(s?.lossStreak)}`,detail:zh?'胜 / 负':'wins / losses'}
  ].filter(c=>c.value!=='—')
}
