import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertPublicAssetUrl } from '@shared/asset-urls'

const BUDGET_BYTES = 500 * 1024 * 1024

export function readPin(file: string | null): string | null {
  if (!file || !fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { dataDragon?: { version?: string } }
    return parsed.dataDragon?.version ?? null
  } catch {
    return null
  }
}

export class AssetCache {
  constructor(private readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true })
  }

  async publish(input: { provider: string; version: string; locale: string; entityType: string; entityId: string; sourceUrl: string; bytes: Uint8Array }): Promise<string> {
    assertPublicAssetUrl(input.sourceUrl)
    if (input.bytes.byteLength > 10 * 1024 * 1024) throw new Error('asset-too-large')
    const digest = createHash('sha256').update(input.bytes).digest('hex')
    const relative = path.join(input.provider, input.version, input.locale, input.entityType, input.entityId, `${digest}.bin`)
    const destination = path.join(this.directory, relative)
    const temporary = `${destination}.partial`
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(temporary, input.bytes)
    fs.renameSync(temporary, destination)
    this.evict()
    return relative.replaceAll('\\', '/')
  }

  private evict(): void {
    const files: Array<{ file: string; size: number; mtime: number }> = []
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (!entry.name.endsWith('.partial')) {
          const stat = fs.statSync(full)
          files.push({ file: full, size: stat.size, mtime: stat.mtimeMs })
        }
      }
    }
    walk(this.directory)
    let total = files.reduce((sum, file) => sum + file.size, 0)
    files.sort((left, right) => left.mtime - right.mtime)
    for (const file of files) {
      if (total <= BUDGET_BYTES) break
      fs.rmSync(file.file, { force: true })
      total -= file.size
    }
  }
}
