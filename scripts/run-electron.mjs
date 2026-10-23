import { spawn } from 'node:child_process'
import path from 'node:path'

const mode = process.argv[2] === 'demo' ? 'demo' : 'dev'
const env = { ...process.env }
if (mode === 'demo') {
  env.ARAM_WRAPPED_MODE = 'demo'
  env.ARAM_WRAPPED_OFFLINE = '1'
}
const binary = path.join('node_modules', '.bin', process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite')
const child = spawn(binary, ['dev'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
})
child.on('exit', (code) => process.exit(code ?? 0))
