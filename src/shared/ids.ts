const SAFE_INT = BigInt(Number.MAX_SAFE_INTEGER)

export function asIdString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return null
}

export function parseLcuJson(text: string): unknown {
  const preserved = text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"')
  const withGameIds = preserved.replace(/("gameId"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(withGameIds, (_key, value) => {
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
      throw new Error('unsafe-integer')
    }
    return value
  })
}

export function isUnsafeIntegerToken(value: string): boolean {
  if (!/^-?\d+$/.test(value)) return false
  const digits = value.replace(/^-/, '').replace(/^0+/, '')
  if (digits.length > 16) return true
  try {
    return BigInt(value) > SAFE_INT
  } catch {
    return true
  }
}
