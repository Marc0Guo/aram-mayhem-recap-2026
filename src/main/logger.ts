import fs from 'node:fs'
import path from 'node:path'
import { redact } from '@shared/redact'

export class Logger {
  constructor(
    private readonly directory: string,
    private readonly maxBytes = 10 * 1024 * 1024
  ) {
    fs.mkdirSync(directory, { recursive: true })
  }

  info(event: string, fields: Record<string, unknown> = {}): void {
    const line = `${JSON.stringify(redact({ t: new Date().toISOString(), event, ...fields }))}\n`
    const file = path.join(this.directory, 'app.log')
    this.rotate(file, Buffer.byteLength(line))
    fs.appendFileSync(file, line)
  }

  private rotate(file: string, incoming: number): void {
    let size = 0
    try {
      size = fs.statSync(file).size
    } catch {
      return
    }
    if (size + incoming < this.maxBytes) return
    fs.rmSync(path.join(this.directory, 'app.log.3'), { force: true })
    for (let generation = 2; generation >= 1; generation -= 1) {
      const source = path.join(this.directory, `app.log.${generation}`)
      const dest = path.join(this.directory, `app.log.${generation + 1}`)
      if (fs.existsSync(source)) fs.renameSync(source, dest)
    }
    if (fs.existsSync(file)) fs.renameSync(file, path.join(this.directory, 'app.log.1'))
  }
}
