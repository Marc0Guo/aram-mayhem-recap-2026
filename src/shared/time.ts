export interface TimeRange {
  startUtc: number
  endUtc: number
  startDate: string
  endDate: string
  timeZone: string
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return true
  } catch {
    return false
  }
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function partsInZone(utcMs: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const map: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  let hour = Number(map.hour)
  let day = Number(map.day)
  let month = Number(map.month)
  let year = Number(map.year)
  if (hour === 24) {
    hour = 0
    const rolled = new Date(Date.UTC(year, month - 1, day + 1))
    year = rolled.getUTCFullYear()
    month = rolled.getUTCMonth() + 1
    day = rolled.getUTCDate()
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second)
  }
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = partsInZone(utcMs, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - utcMs
}

export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = guess - zoneOffsetMs(guess, timeZone)
  return guess - zoneOffsetMs(first, timeZone)
}

export function startOfLocalDayUtc(isoDate: string, timeZone: string): number {
  const match = DATE_RE.exec(isoDate)
  if (!match) throw new Error('bad-date')
  return zonedTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0, timeZone)
}

export function formatLocalDate(utcMs: number, timeZone: string): string {
  const parts = partsInZone(utcMs, timeZone)
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = DATE_RE.exec(isoDate)
  if (!match) throw new Error('bad-date')
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return shifted.toISOString().slice(0, 10)
}

export function formatLocalDateTime(utcMs: number, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(utcMs))
}

export interface PresetInput {
  preset: 'last7' | 'last30' | 'lastWeek' | 'thisYear' | 'all' | 'custom'
  nowUtc: number
  timeZone: string
  customStart?: string | null
  customEnd?: string | null
}

function mondayOf(isoDate: string): string {
  const match = DATE_RE.exec(isoDate)
  if (!match) throw new Error('bad-date')
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const weekday = utc.getUTCDay()
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1
  return addCalendarDays(isoDate, -daysFromMonday)
}

export function resolvePreset(input: PresetInput): TimeRange {
  if (!isValidTimeZone(input.timeZone)) throw new Error('invalid-timezone')
  if (input.preset === 'all') {
    return {
      startUtc: 0,
      endUtc: Number.MAX_SAFE_INTEGER,
      startDate: '',
      endDate: '',
      timeZone: input.timeZone
    }
  }
  const today = formatLocalDate(input.nowUtc, input.timeZone)
  let startDate = today
  let endDate = today
  if (input.preset === 'last7') {
    startDate = addCalendarDays(today, -6)
    endDate = today
  } else if (input.preset === 'last30') {
    startDate = addCalendarDays(today, -29)
    endDate = today
  } else if (input.preset === 'lastWeek') {
    const thisMonday = mondayOf(today)
    endDate = addCalendarDays(thisMonday, -1)
    startDate = addCalendarDays(thisMonday, -7)
  } else if (input.preset === 'thisYear') {
    startDate = `${today.slice(0, 4)}-01-01`
    endDate = `${Number(today.slice(0, 4))}-12-31`
  } else {
    if (!input.customStart || !input.customEnd) throw new Error('custom-range-required')
    startDate = input.customStart
    endDate = input.customEnd
    if (startDate > endDate) throw new Error('custom-range-order')
  }
  return {
    startUtc: startOfLocalDayUtc(startDate, input.timeZone),
    endUtc: startOfLocalDayUtc(addCalendarDays(endDate, 1), input.timeZone),
    startDate,
    endDate,
    timeZone: input.timeZone
  }
}

export function inHalfOpenRange(startUtc: number, rangeStart: number, rangeEnd: number): boolean {
  return startUtc >= rangeStart && startUtc < rangeEnd
}

export function eachLocalDate(rangeStartUtc: number, rangeEndUtc: number, timeZone: string, limit = 800): string[] {
  if (!(rangeEndUtc > rangeStartUtc)) return []
  const dates: string[] = []
  let cursor = formatLocalDate(rangeStartUtc, timeZone)
  for (let i = 0; i < limit; i += 1) {
    const dayStart = startOfLocalDayUtc(cursor, timeZone)
    if (dayStart >= rangeEndUtc) break
    const dayEnd = startOfLocalDayUtc(addCalendarDays(cursor, 1), timeZone)
    if (dayEnd > rangeStartUtc && dayStart < rangeEndUtc) dates.push(cursor)
    const next = addCalendarDays(cursor, 1)
    if (next <= cursor) break
    cursor = next
  }
  return dates
}
