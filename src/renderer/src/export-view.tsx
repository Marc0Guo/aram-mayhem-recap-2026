import type { ExportSnapshot } from '@shared/types'

export function ExportView({ snapshot }: { snapshot: ExportSnapshot }) {
  return (
    <article className="export-root" data-export-root>
      {snapshot.demoWatermark ? <div className="watermark">DEMO</div> : null}
      <p className="ribbon" data-export-part="badge">{snapshot.demoWatermark ? 'DEMO' : snapshot.rangeLabel}</p>
      <h1 data-export-part="title">{snapshot.title}</h1>
      <p data-export-part="range">{snapshot.rangeLabel}</p>
      {snapshot.alias ? <p data-export-part="alias">{snapshot.alias}</p> : null}
      <section className="story-grid">
        <div className="story-card" data-export-part="games"><b>{snapshot.gamesText}</b></div>
        <div className="story-card" data-export-part="record"><b>{snapshot.recordText}</b><span>{snapshot.winRateText}</span></div>
        <div className="story-card" data-export-part="favorite"><b>{snapshot.favoriteText}</b></div>
        <div className="story-card" data-export-part="playtime"><b>{snapshot.playtimeText}</b></div>
      </section>
      <section className="story-card" data-export-part="augments" style={{ marginTop: 18 }}>
        <p>{snapshot.augments.note}</p>
        <ul className="story-list">
          {snapshot.augments.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <section className="story-card" data-export-part="items" style={{ marginTop: 18 }}>
        <p>{snapshot.items.note}</p>
        <ul className="story-list">
          {snapshot.items.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <footer className="export-footer" data-export-part="footer">
        <p>{snapshot.coverageFooter}</p>

      </footer>
    </article>
  )
}
