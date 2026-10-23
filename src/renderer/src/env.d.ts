import type { AramApi, ExportSnapshot } from '@shared/bridge'

declare global {
  interface Window {
    aram: AramApi & {
      pullExport: () => Promise<ExportSnapshot>
      signalExportReady: () => void
    }
  }
}

export {}
