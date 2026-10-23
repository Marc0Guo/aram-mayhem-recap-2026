import type { BrowserWindow } from 'electron'

export function hardenWindow(win: BrowserWindow, allowedOrigins: string[]): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || allowedOrigins.some((origin) => url.startsWith(origin))
    if (!allowed) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

export const rendererSecurity = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false
} as const
