const Database = require('better-sqlite3')

const db = new Database(':memory:')
db.pragma('journal_mode = WAL')
const version = db.prepare('select sqlite_version() as version').get()
db.close()
process.stdout.write(`${JSON.stringify({
  ok: true,
  sqlite: version.version,
  electron: process.versions.electron ?? null,
  napi: process.versions.napi ?? null
})}\n`)
if (process.versions.electron) {
  require('electron').app.exit(0)
} else {
  process.exit(0)
}
