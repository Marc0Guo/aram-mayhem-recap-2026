import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'

const SENSITIVE = new Set([
  'puuid',
  'summonerId',
  'summonerName',
  'riotIdName',
  'riotIdTagline',
  'accountId',
  'password',
  'authorization',
  'gameName',
  'tagLine',
  'displayName',
  'internalName',
  'privacy'
])

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false, maxSockets: 1 })

function parseLockfile(text) {
  const parts = text.trim().split(':')
  if (parts.length < 5) return null
  const pid = Number(parts[1])
  const port = Number(parts[2])
  const protocol = parts.at(-1) ?? ''
  const password = parts.slice(3, -1).join(':')
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 2999) return null
  if (!password || protocol !== 'https') return null
  return { pid, port, password }
}

function pidIsLeague(pid) {
  const stdout = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    windowsHide: true,
    timeout: 5000,
    encoding: 'utf8'
  })
  const match = String(stdout).match(new RegExp(`"([^"]+)"\\s*,\\s*"${pid}"`, 'i'))
  return Boolean(match?.[1] && /^LeagueClient/i.test(match[1]))
}

function parseBody(text) {
  const preserved = text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"')
  const withGameIds = preserved.replace(/("gameId"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(withGameIds)
}

function getJson(port, password, resourcePath) {
  const authorization = `Basic ${Buffer.from(`riot:${password}`).toString('base64')}`
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: '127.0.0.1',
        port,
        path: resourcePath,
        method: 'GET',
        headers: { Authorization: authorization, Accept: 'application/json' },
        agent,
        timeout: 8000,
        servername: '127.0.0.1'
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({ status: response.statusCode ?? 0, body })
        })
      }
    )
    request.on('timeout', () => {
      request.destroy()
      reject(new Error('timeout'))
    })
    request.on('error', () => reject(new Error('network')))
    request.end()
  })
}

function gamesOf(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return null
  if (Array.isArray(payload.games)) return payload.games
  if (payload.games && typeof payload.games === 'object' && Array.isArray(payload.games.games)) return payload.games.games
  return null
}

function gameIdOf(game) {
  if (!game || typeof game !== 'object') return null
  const value = game.gameId
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return null
}

function typeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function schemaOf(value, depth = 0) {
  if (depth > 5) return typeName(value)
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, item: value.length ? schemaOf(value[0], depth + 1) : null }
  }
  if (!value || typeof value !== 'object') return typeName(value)
  const output = {}
  for (const key of Object.keys(value).sort()) {
    if (SENSITIVE.has(key)) {
      output[key] = 'redacted'
      continue
    }
    output[key] = schemaOf(value[key], depth + 1)
  }
  return output
}

function augmentPaths(value, pathName, found) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    if (value.length) augmentPaths(value[0], `${pathName}[]`, found)
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    const next = pathName ? `${pathName}.${key}` : key
    if (/augment/i.test(key)) found.add(`${next}:${typeName(entry)}`)
    if (!SENSITIVE.has(key)) augmentPaths(entry, next, found)
  }
}

function numberRange(values) {
  const nums = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (!nums.length) return null
  return { count: nums.length, min: Math.min(...nums), max: Math.max(...nums) }
}

function sanitizedFixture(detail, selfPuuid) {
  const drop = new Set([...SENSITIVE, 'matchHistoryUri', 'currentAccountId', 'privacy'])
  const selfIdentity = Array.isArray(detail.participantIdentities)
    ? detail.participantIdentities.find((item) => item?.player?.puuid === selfPuuid)
    : null
  const selfId = selfIdentity?.participantId
  const walk = (node) => {
    if (Array.isArray(node)) return node.map((entry) => walk(entry))
    if (!node || typeof node !== 'object') return node
    const output = {}
    for (const [key, value] of Object.entries(node)) {
      if (drop.has(key)) continue
      output[key] = walk(value)
    }
    return output
  }
  const cleaned = walk(detail)
  cleaned.gameId = 'sanitized-mayhem-1'
  if (Array.isArray(cleaned.participantIdentities)) {
    cleaned.participantIdentities = cleaned.participantIdentities.map((identity) => ({
      participantId: identity.participantId,
      player: identity.participantId === selfId ? { puuid: 'self' } : { platformId: 'NA1' }
    }))
  }
  return cleaned
}

function assertClean(report, password, puuid) {
  const text = JSON.stringify(report)
  if (password.length >= 4 && text.includes(password)) throw new Error('report-contained-secret')
  if (puuid.length >= 12 && text.includes(puuid)) throw new Error('report-contained-secret')
}

async function main() {
  const lockPath = path.join('C:\\Riot Games\\League of Legends', 'lockfile')
  let text
  try {
    text = fs.readFileSync(lockPath, 'utf8')
  } catch {
    console.log(JSON.stringify({ discovery: 'missing' }))
    return
  }
  const parsed = parseLockfile(text)
  if (!parsed) {
    console.log(JSON.stringify({ discovery: parsed === null && text.includes(':') ? 'malformed-or-wrong-service' : 'malformed' }))
    return
  }
  if (!pidIsLeague(parsed.pid)) {
    console.log(JSON.stringify({ discovery: 'stale' }))
    return
  }

  const secrets = [parsed.password]
  const summonerResponse = await getJson(parsed.port, parsed.password, '/lol-summoner/v1/current-summoner')
  const report = {
    discovery: 'found',
    summoner: { status: summonerResponse.status },
    history: {},
    detail: {},
    paging: {},
    queues: {},
    duration: {},
    augments: [],
    selfLinked: null
  }
  if (summonerResponse.status !== 200) {
    assertClean(report, parsed.password, '')
    console.log(JSON.stringify(report))
    return
  }
  const summoner = parseBody(summonerResponse.body)
  const puuid = typeof summoner.puuid === 'string' ? summoner.puuid : ''
  secrets.push(puuid, summoner.gameName, summoner.tagLine, summoner.displayName, summoner.summonerName)
  report.summoner = {
    status: 200,
    keys: Object.keys(summoner).sort(),
    hasPuuid: Boolean(puuid),
    hasGameName: typeof summoner.gameName === 'string' && summoner.gameName.length > 0,
    hasTagLine: typeof summoner.tagLine === 'string' && summoner.tagLine.length > 0,
    platformId: typeof summoner.platformId === 'string' && /^[A-Z0-9]{2,8}$/.test(summoner.platformId) ? summoner.platformId : null
  }
  if (!puuid) {
    assertClean(report, parsed.password, puuid)
    console.log(JSON.stringify(report))
    return
  }

  async function page(beg, end) {
    const response = await getJson(
      parsed.port,
      parsed.password,
      `/lol-match-history/v1/products/lol/${encodeURIComponent(puuid)}/matches?begIndex=${beg}&endIndex=${end}`
    )
    const payload = response.status === 200 ? parseBody(response.body) : null
    return { status: response.status, payload, games: payload ? gamesOf(payload) : null }
  }

  const smallA = await page(0, 1)
  const smallB = await page(0, 2)
  const smallC = await page(1, 2)
  const ids = (games) => (games ?? []).map(gameIdOf)
  const a = ids(smallA.games)
  const b = ids(smallB.games)
  const c = ids(smallC.games)
  let indexMode = 'ambiguous'
  if (a.length === 1 && b.length === 2 && c.length === 1 && b[1] === c[0] && b[0] === a[0]) indexMode = 'endExclusive'
  else if (a.length === 2 && b.length === 3 && c.length === 2 && a[1] === c[0]) indexMode = 'endInclusive'

  const listWrapper = smallB.payload && typeof smallB.payload === 'object' ? smallB.payload : null
  const nested = listWrapper && listWrapper.games && typeof listWrapper.games === 'object' && !Array.isArray(listWrapper.games) ? listWrapper.games : null
  report.history = {
    status: smallB.status,
    shape: Array.isArray(smallB.payload) ? 'array' : nested ? 'games.games' : Array.isArray(smallB.games) ? 'games' : 'unrecognized',
    wrapperKeys: listWrapper ? Object.keys(listWrapper).sort() : [],
    nestedKeys: nested ? Object.keys(nested).sort() : [],
    sampleGameKeys: smallB.games?.[0] && typeof smallB.games[0] === 'object' ? Object.keys(smallB.games[0]).sort() : []
  }
  const ranges = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [2, 4], [3, 5], [0, 20], [4, 8]]
  const rangeFacts = []
  for (const [beg, end] of ranges) {
    const result = await page(beg, end)
    const nestedMeta = result.payload?.games && typeof result.payload.games === 'object' && !Array.isArray(result.payload.games) ? result.payload.games : null
    const idList = ids(result.games)
    rangeFacts.push({
      beg,
      end,
      status: result.status,
      returned: idList.length,
      gameCount: typeof nestedMeta?.gameCount === 'number' ? nestedMeta.gameCount : null,
      gameIndexBegin: typeof nestedMeta?.gameIndexBegin === 'number' ? nestedMeta.gameIndexBegin : null,
      gameIndexEnd: typeof nestedMeta?.gameIndexEnd === 'number' ? nestedMeta.gameIndexEnd : null,
      idFingerprint: createHash('sha256').update(idList.join('|')).digest('hex').slice(0, 8)
    })
  }
  report.paging = {
    indexMode,
    countBeg0End1: a.length,
    countBeg0End2: b.length,
    countBeg1End2: c.length,
    boundaryContinues: indexMode !== 'ambiguous',
    ranges: rangeFacts
  }
  const pageSize = indexMode === 'endInclusive' ? 19 : 20
  const first = await page(0, pageSize)
  const second = await page(pageSize, pageSize * 2)
  const sample = [...(first.games ?? []), ...(second.games ?? [])]
  const queues = {}
  const modes = {}
  const maps = {}
  const durations = []
  const creations = []
  const augmentFound = new Set()
  for (const game of sample) {
    if (!game || typeof game !== 'object') continue
    const queue = Number.isInteger(game.queueId) ? String(game.queueId) : 'null'
    const mode = typeof game.gameMode === 'string' ? game.gameMode : 'missing'
    queues[queue] = (queues[queue] ?? 0) + 1
    modes[`${queue}:${mode}`] = (modes[`${queue}:${mode}`] ?? 0) + 1
    if (Number.isInteger(game.mapId)) maps[String(game.mapId)] = (maps[String(game.mapId)] ?? 0) + 1
    if (typeof game.gameDuration === 'number') durations.push(game.gameDuration)
    if (typeof game.gameCreation === 'number') creations.push(game.gameCreation)
    augmentPaths(game, '', augmentFound)
  }
  report.queues = { sampleSize: sample.length, queueCounts: queues, queueModeCounts: modes, mapCounts: maps }
  const duration = numberRange(durations)
  report.duration = {
    field: durations.length ? 'gameDuration' : null,
    ...duration,
    unit: duration && duration.max < 20000 && duration.min >= 0 ? 'seconds' : duration ? 'unclassified' : null,
    gameCreationIsEpochMs: creations.length > 0 && creations.every((value) => value > 1e11)
  }
  report.augments = [...augmentFound].sort()
  report.listSchema = schemaOf(first.games?.[0] ?? null)

  const detailId = gameIdOf(first.games?.[0])
  if (detailId) {
    const detailResponse = await getJson(parsed.port, parsed.password, `/lol-match-history/v1/games/${encodeURIComponent(detailId)}`)
    report.detail.status = detailResponse.status
    if (detailResponse.status === 200) {
      const detail = parseBody(detailResponse.body)
      augmentPaths(detail, 'detail', augmentFound)
      report.augments = [...augmentFound].sort()
      report.detail.keys = detail && typeof detail === 'object' ? Object.keys(detail).sort() : []
      report.detail.sameGameId = gameIdOf(detail) === detailId
      const identities = Array.isArray(detail.participantIdentities) ? detail.participantIdentities : []
      const participants = Array.isArray(detail.participants) ? detail.participants : []
      const identity = identities.find((item) => item?.player?.puuid === puuid)
      const participantId = identity?.participantId
      const participant = participants.find((item) => item?.participantId === participantId)
      report.selfLinked = Boolean(identity && participant)
      report.detail.identityKeys = identity ? Object.keys(identity).sort() : []
      report.detail.playerKeys = identity?.player ? Object.keys(identity.player).sort() : []
      report.detail.participantKeys = participant ? Object.keys(participant).sort() : []
      report.detail.statsKeys = participant?.stats && typeof participant.stats === 'object' ? Object.keys(participant.stats).sort() : []
      report.detail.schema = schemaOf({
        participantIdentities: identity ? [identity] : [],
        participants: participant ? [participant] : []
      })
      const nameFields = [identity?.player?.gameName, identity?.player?.summonerName, identity?.player?.riotIdName].filter((value) => typeof value === 'string')
      secrets.push(...nameFields)
    }
  }

  const enumToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_:+./-]{1,48}$/.test(value) ? value : null
  const mutators = new Set()
  const results = new Set()
  const gameTypes = new Set()
  const versions = new Set()
  let participantMin = null
  let participantMax = null
  let gamesWithAugmentKeys = 0
  let gamesWithNonZeroAugment = 0
  const nonzeroAugments = new Set()
  for (const game of sample) {
    if (!game || typeof game !== 'object') continue
    if (Array.isArray(game.gameModeMutators)) {
      for (const token of game.gameModeMutators) {
        const safe = enumToken(token)
        if (safe) mutators.add(safe)
      }
    }
    const resultToken = enumToken(game.endOfGameResult)
    if (resultToken) results.add(resultToken)
    const typeToken = enumToken(game.gameType)
    if (typeToken) gameTypes.add(typeToken)
    const version = enumToken(game.gameVersion)
    if (version) versions.add(version)
    const count = Array.isArray(game.participants) ? game.participants.length : null
    if (count != null) {
      participantMin = participantMin == null ? count : Math.min(participantMin, count)
      participantMax = participantMax == null ? count : Math.max(participantMax, count)
    }
    const identity = Array.isArray(game.participantIdentities) ? game.participantIdentities.find((item) => item?.player?.puuid === puuid) : null
    const participant = Array.isArray(game.participants) ? game.participants.find((item) => item?.participantId === identity?.participantId) : game.participants?.[0]
    const stats = participant?.stats
    if (stats && typeof stats === 'object' && [1, 2, 3, 4, 5, 6].every((slot) => typeof stats[`playerAugment${slot}`] === 'number')) {
      gamesWithAugmentKeys += 1
      const picked = [1, 2, 3, 4, 5, 6].map((slot) => stats[`playerAugment${slot}`]).filter((value) => value > 0)
      if (picked.length) {
        gamesWithNonZeroAugment += 1
        for (const value of picked) nonzeroAugments.add(value)
      }
    }
  }
  const detailParticipants = report.detail.status === 200 ? 'see-detail-call' : null
  report.facts = {
    wrapperPlatformId: enumToken(listWrapper?.platformId),
    gameMode: 'KIWI-observed-in-queue-key',
    mutators: [...mutators],
    endOfGameResult: [...results],
    gameType: [...gameTypes],
    gameVersion: [...versions],
    listParticipantCount: { min: participantMin, max: participantMax },
    detailParticipantNote: detailParticipants,
    augmentSlotsPresent: gamesWithAugmentKeys,
    augmentGamesNonZero: gamesWithNonZeroAugment,
    nonzeroAugmentCount: nonzeroAugments.size,
    sampleGames: sample.length
  }
  if (detailId) {
    const detailResponse = await getJson(parsed.port, parsed.password, `/lol-match-history/v1/games/${encodeURIComponent(detailId)}`)
    if (detailResponse.status === 200) {
      const detail = parseBody(detailResponse.body)
      report.facts.detailParticipantCount = Array.isArray(detail.participants) ? detail.participants.length : null
      report.facts.detailIdentityCount = Array.isArray(detail.participantIdentities) ? detail.participantIdentities.length : null
    }
  }

  if (process.env.ARAM_WRAPPED_WRITE_FIXTURE === '1' && detailId) {
    const detailResponse = await getJson(parsed.port, parsed.password, `/lol-match-history/v1/games/${encodeURIComponent(detailId)}`)
    if (detailResponse.status !== 200) throw new Error('fixture-detail-unavailable')
    const detail = parseBody(detailResponse.body)
    const fixture = sanitizedFixture(detail, puuid)
    const encoded = JSON.stringify(fixture, null, 2)
    if (encoded.includes(parsed.password) || encoded.includes(puuid)) throw new Error('report-contained-secret')
    fs.writeFileSync(path.join('fixtures', 'lcu', 'mayhem.sanitized.json'), `${encoded}\n`)
  }

  assertClean(report, parsed.password, puuid)
  console.log(JSON.stringify({
    discovery: report.discovery,
    summoner: report.summoner,
    history: report.history,
    paging: report.paging,
    queues: report.queues,
    duration: report.duration,
    selfLinked: report.selfLinked,
    facts: report.facts
  }, null, 2))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'probe-failed'
  if (message === 'report-contained-secret') {
    console.error('probe refused to print a report that contained a secret')
    process.exit(2)
  }
  if (message === 'timeout' || message === 'network') {
    console.error(message)
    process.exit(1)
  }
  const stack = error instanceof Error ? error.stack ?? '' : ''
  const safe = `${message}\n${stack}`.replace(/[A-Za-z0-9_+:/=-]{8,}/g, '[redacted]')
  console.error(safe.split('\n').slice(0, 8).join('\n'))
  process.exit(1)
})
