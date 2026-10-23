import fs from 'node:fs/promises'
import path from 'node:path'

export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) throw new Error('png-small')
  const signature = Buffer.from(bytes.subarray(0, 8)).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error('png-sig')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

export async function writeAtomically(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${target}.partial`
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(temporary, bytes)
    await fs.rm(target, { force: true })
    await fs.rename(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function runExport(options: {
  freeze: () => Promise<void> | void
  choosePath: () => Promise<string | null>
  render: () => Promise<Uint8Array>
  write?: (target: string, bytes: Uint8Array) => Promise<void>
}): Promise<{ ok: true; path: string } | { ok: false; canceled: boolean; code: string }> {
  await options.freeze()
  const destination = await options.choosePath()
  if (!destination) return { ok: false, canceled: true, code: 'canceled' }
  if (!destination.toLowerCase().endsWith('.png')) return { ok: false, canceled: false, code: 'export_failed' }
  try {
    const bytes = await options.render()
    pngSize(bytes)
    await (options.write ?? writeAtomically)(destination, bytes)
    return { ok: true, path: destination }
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error && error.code === 'ENOSPC' ? 'disk_full' : 'export_failed'
    return { ok: false, canceled: false, code }
  }
}
