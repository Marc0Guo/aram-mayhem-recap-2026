import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ExportSnapshot } from '@shared/types'
import { ExportView } from './export-view'
import './styles.css'

function waitForImages(): Promise<void> {
  const images = [...document.images]
  return Promise.race([
    Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 3000))
  ])
}

function ExportApp() {
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null)
  useEffect(() => {
    void window.aram.pullExport().then(async (value) => {
      setSnapshot(value)
      await document.fonts.ready
      await waitForImages()
      window.aram.signalExportReady()
    })
  }, [])
  return snapshot ? <ExportView snapshot={snapshot} /> : <article className="export-root" data-export-root />
}

createRoot(document.getElementById('root')!).render(<ExportApp />)
