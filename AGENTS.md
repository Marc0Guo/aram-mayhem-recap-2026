# Agent onboarding — Codex, Claude Code, Cursor and other agents

## Start here

Read README.md, package.json, docs/lcu-capabilities.md and the relevant source before editing. This is a Windows x64 local web dashboard, with an optional older Electron host. Current user requirements and working code define the project scope. Never invent match fields or label demo data as real.

## Bootstrap

From the project root, Windows PowerShell: `& ([scriptblock]::Create((Get-Content -LiteralPath ./scripts/start.ps1 -Raw))) -SourcePath (Get-Location).Path`. Add `-Demo` for offline synthetic data, `-NoBrowser` for agent runs, or `-InstallOnly` to verify dependencies without starting a server. No Git or system Node is required; the script installs checksum-verified portable Node under LOCALAPPDATA/AramMayhemWrapped/runtime. Do not modify system execution policy, require elevation or register startup services.

With Node 22 LTS already present: `corepack pnpm install --frozen-lockfile --ignore-scripts`, then `corepack pnpm dev` or `corepack pnpm demo`. packageManager pins pnpm 10.18.2; keep pnpm-lock.yaml. better-sqlite3 13.0.3 contains Windows x64 Node-API prebuilds; do not rebuild native code unnecessarily. The web host does not need Electron downloaded. For Electron/e2e run `node node_modules/electron/install.js` first.

## Commands and verification

- `pnpm typecheck`: main and renderer TypeScript.
- `pnpm lint`: source lint. work/, output and dependencies are excluded.
- `pnpm test`: deterministic fixtures, SQL, sync and privacy tests.
- `pnpm build`: production code; does not launch the app.
- `node scripts/native-smoke.cjs`: SQLite compatibility.
- `pnpm test:e2e`: Electron checks, requires its binary and a desktop session.
- `pnpm assets:verify`: network asset proof; report actual results instead of assuming it passes.
- `node scripts/source-release.mjs`: clean source ZIP in publish/, excluding private files.

Use a separate data directory for automated tests: ARAM_WRAPPED_DATA_DIR. Never run Demo against the user's real data directory. The bootstrap separates them. The web port is ARAM_WRAPPED_PORT (default 4173), always loopback. ARAM_WRAPPED_OPEN_BROWSER=1 enables automatic browser opening. Stop only a server you started. Never kill unrelated League or user processes.

## Repository map

src/renderer/src: App.tsx, Recap.tsx, styles.css, PNG export and settings. src/shared: DTOs, bilingual labels, metrics, privacy helpers, catalogs. src/main/lcu: discovery, authenticated GET transport, adapters. src/main/sync: bounded, idempotent sync and cache-safe paging. src/main/db: transactional SQLite and migrations. src/main/services: queries, current profile and challenges. src/web: HTTP bridge. fixtures: synthetic/sanitized evidence. tests: unit and integration. docs: definitions and observed capabilities.

## Data and privacy rules

Real data stays in LOCALAPPDATA/AramMayhemWrapped/data; demo stays in demo/. Anonymous mode is a persisted browser display preference, replacing self ID with a chosen alias and every teammate ID with alias's friends; check visible text, title/alt attributes and PNG. Do not mutate the real database to implement anonymity. Clear export messages when changing privacy mode, and ignore a potentially identifying custom export title in anonymous mode.

Only read LCU GET endpoints. Credentials remain in the main/server process; renderer gets no arbitrary HTTP, SQL, credentials or filesystem access. Restrict self-signed TLS exceptions to the discovered local service; ordinary asset downloads retain TLS verification. Never log lockfile contents, passwords, Authorization, PUUIDs or process command lines. No API key, cloud database, game writes, background collector or disk-wide discovery.

Confirm queue 2400 Mayhem from recorded evidence; ARAM map/mode alone does not classify games. Missing fields stay unavailable. No augment power ranking or win-rate recommendation. Client history can be capped or cached; do not equate a page count with total history. Cache-safe paging must validate returned indices. Keep stored games when the client stops returning them.

## Design and handoff

Follow the provided recap reference: #1 center, #2 left, #3 right, actual mastery and uniform rows #4–10; gold highlights game counts, secondary stats stay muted. UI and PNG support Chinese/English. Do not reintroduce removed disclaimer copy, paging controls or unavailable Pings/snowball/poro cards. Keep LoboBot Recap 2024 design credit in README and asset provenance in THIRD_PARTY_NOTICES.md.

Run checks appropriate to the change, inspect the actual PNG and report limitations. Never claim a clean Windows installation, real-client sync or successful export without executing it. Do not publish or push without user authorization. No credentials, databases, private work/, local reports, dependencies or personal screenshots in the source release. User changes must be preserved.
