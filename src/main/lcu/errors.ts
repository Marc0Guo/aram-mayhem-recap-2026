export class TransportError extends Error {
  readonly name = 'TransportError'

  constructor(
    public readonly code: 'timeout' | 'network' | 'http' | 'redirect' | 'non_loopback' | 'malformed_json' | 'client_exited' | 'offline',
    public readonly status = 0,
    public readonly retryAfterMs: number | null = null
  ) {
    super(code)
  }
}

export class AdapterError extends Error {
  readonly name = 'AdapterError'
  constructor(public readonly code: string) {
    super(code)
  }
}

export class SyncHalt extends Error {
  readonly name = 'SyncHalt'
  constructor(public readonly reason: 'account_changed' | 'cancelled' | 'offline' | 'capability_forbidden' | 'budget_time') {
    super(reason)
  }
}
