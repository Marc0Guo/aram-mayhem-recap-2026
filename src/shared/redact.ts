const SENSITIVE_KEY = /puuid|password|authorization|lockfile|token|secret/i
const LOCKFILE_EMBEDDED = /[A-Za-z][\w.-]*:\d+:\d+:.*?:https?\b/gi
const BASIC = /Basic\s+[A-Za-z0-9+/=]+/gi
const BEARER = /Bearer\s+\S+/gi
const LONG_ID = /[A-Za-z0-9_-]{70,}/g

export function redactString(value: string): string {
  return value
    .replace(LOCKFILE_EMBEDDED, '[redacted-lockfile]')
    .replace(BASIC, 'Basic [redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(LONG_ID, '[redacted-id]')
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value
  if (Array.isArray(value)) return value.map((entry) => redact(entry))
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(entry)
    }
    return output
  }
  return '[unsupported]'
}
