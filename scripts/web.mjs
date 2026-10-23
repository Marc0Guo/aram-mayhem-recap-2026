import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer as createVite } from 'vite'

const root = process.cwd()
const demo = process.argv.includes('demo')
if (demo) {
  process.env.ARAM_WRAPPED_MODE = 'demo'
  process.env.ARAM_WRAPPED_OFFLINE = '1'
}

const vite = await createVite({
  configFile: false,
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(root, 'src/shared'),
      '@renderer': path.resolve(root, 'src/renderer/src')
    }
  },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  ssr: { external: ['better-sqlite3', 'electron'] }
})

const hostModule = await vite.ssrLoadModule(pathToFileURL(path.resolve(root, 'src/web/host.ts')).href)
const host = await hostModule.createHost()
const template = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
  .replace('./src/main.tsx', '/src/renderer/src/main.tsx')

const server = createServer(async (req, res) => {
  try {
    if (await host.handle(req, res)) return
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await vite.transformIndexHtml(url.pathname, template)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    vite.middlewares(req, res, () => {
      res.writeHead(404).end('not found')
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'request failed')
    if (!res.headersSent) res.writeHead(500)
    res.end('error')
  }
})

const port = Number(process.env.ARAM_WRAPPED_PORT || 4173)
server.on('error', async error => { console.error(error.message); await host.close(); await vite.close(); process.exitCode = 1 })
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`
  console.log(url)
  if (process.env.ARAM_WRAPPED_OPEN_BROWSER === '1' && process.platform === 'win32') {
    const opener = spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' })
    opener.on('error', () => console.log(`Open ${url} in your browser.`))
  }
})

async function stop() {
  server.close()
  await host.close()
  await vite.close()
  process.exit(0)
}

process.on('SIGINT', () => { void stop() })
process.on('SIGTERM', () => { void stop() })
