import https from 'node:https'
import { TransportError } from './errors'

export interface PlannedRequest {
  host: '127.0.0.1'
  port: number
  path: string
}

export interface TransportResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

const loopbackAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: false,
  maxSockets: 2
})

export function planLoopbackGet(port: number, resourcePath: string): PlannedRequest {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 2999) {
    throw new TransportError('non_loopback', 0)
  }
  if (!resourcePath.startsWith('/') || resourcePath.startsWith('//')) {
    throw new TransportError('non_loopback', 0)
  }
  const url = new URL(resourcePath, `https://127.0.0.1:${port}`)
  if (url.origin !== `https://127.0.0.1:${port}`) throw new TransportError('non_loopback', 0)
  return { host: '127.0.0.1', port, path: `${url.pathname}${url.search}` }
}

export function defaultLoopbackRequest(plan: PlannedRequest, authorization: string, timeoutMs: number): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: '127.0.0.1',
        port: plan.port,
        path: plan.path,
        method: 'GET',
        headers: {
          Authorization: authorization,
          Accept: 'application/json'
        },
        agent: loopbackAgent,
        timeout: timeoutMs,
        servername: '127.0.0.1'
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )
    request.on('socket', (socket) => {
      socket.on('secureConnect', () => {
        const address = socket.remoteAddress
        if (address && address !== '127.0.0.1' && address !== '::ffff:127.0.0.1') {
          socket.destroy()
          reject(new TransportError('non_loopback', 0))
        }
      })
    })
    request.on('timeout', () => {
      request.destroy()
      reject(new TransportError('timeout', 0))
    })
    request.on('error', () => reject(new TransportError('network', 0)))
    request.end()
  })
}

export async function lcuGet(options: {
  port: number
  resourcePath: string
  authorization: string
  timeoutMs?: number
  offline?: boolean
  request?: (plan: PlannedRequest, authorization: string, timeoutMs: number) => Promise<TransportResponse>
}): Promise<{ status: number; body: string; headers: TransportResponse['headers'] }> {
  if (options.offline) throw new TransportError('offline', 0)
  const plan = planLoopbackGet(options.port, options.resourcePath)
  const response = await (options.request ?? defaultLoopbackRequest)(plan, options.authorization, options.timeoutMs ?? 5000)
  if (response.status >= 300 && response.status < 400) throw new TransportError('redirect', response.status)
  return response
}
