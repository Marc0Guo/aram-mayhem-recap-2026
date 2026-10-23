import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-pnpm-'))
fs.writeFileSync(path.join(dir, 'pnpm.cmd'), '@echo off\r\ncorepack pnpm %*\r\n', 'ascii')
const env = { ...process.env, PATH: `${dir};${process.env.PATH ?? ''}` }
const child = spawn(process.argv[2], process.argv.slice(3), {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
})
child.on('exit', (code) => process.exit(code ?? 0))
