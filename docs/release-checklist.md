# Release checklist

`REAL_CLIENT_IMPORT_VERIFIED` is true after the 2026-10-21 local read. Queue 2400 is confirmed Mayhem. `fixtures/lcu/mayhem.sanitized.json` is the sanitized detail. The asset image gate is still failed, and a clean Windows VM was not run.

| Check | Evidence | Status |
| --- | --- | --- |
| AT01 offline demo, 12 games, 7/5, 58.3% | `tests/storage-sync.test.ts` demo seed | Unit coverage. Electron UI not yet recorded here. |
| AT02 idempotent replace | storage tests | Unit coverage |
| AT03 overlap stop and first-known does not end the scan | sync incremental test | Unit coverage |
| AT04 index mismatch, budget, relaunch from newest | paging test and budget sync test | Unit coverage |
| AT05 crash between parent and child | storage crash test | Unit coverage |
| AT06 lockfile, 401 once, account change, shared self rows | security and sync tests | Unit coverage |
| AT07 403, 404, 500 retries, redaction, non-loopback | sync and security tests | Unit coverage. Offline packet capture not recorded. |
| AT08 classification and augment 3/8 | metrics test | Unit coverage |
| AT09 KDA 2.5, damage 600/min, duplicate item once | metrics test | Unit coverage |
| AT10 DST, Monday week, leap day | time test | Unit coverage |
| AT11 exact PNG, cancel, disk full | export unit test covers cancel and disk full. Pixel PNG not yet captured. | Partial |
| AT12 schema, corruption, non-ASCII path, shared delete | storage tests | Partial. Clean VM, installer, and real-client import are not done. |
| assets:verify release gate | `docs/assets-verification.json` | Ran 2026-10-21. Exit 2. Data Dragon champion 157 and item 3031 images checked. Release gate failed because no sanitized Mayhem augment exists. |
| Native SQLite in Electron | `node node_modules/electron/cli.js scripts/native-smoke.cjs` | Passed. SQLite 3.53.4, Electron 44.9.3, Node-API 10. |
| Policy and fan attribution | README | Not a legal approval |

Commands executed on 2026-10-21 from this checkout:

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` and `tsconfig.web.json`: passed
- `node node_modules/eslint/bin/eslint.js .`: passed
- `node node_modules/vitest/vitest.mjs run`: 24 tests passed
- `node node_modules/electron-vite/bin/electron-vite.js build`: passed
- `node node_modules/@playwright/test/cli.js test`: 1 Electron demo test passed
- `node node_modules/electron/cli.js scripts/native-smoke.cjs`: passed
- `node scripts/assets-verify.mjs`: exit 2, release gate not passed
- `corepack pnpm dist:win`: produced `release\ARAM Mayhem Wrapped-Setup-1.0.0.exe` (131,999,294 bytes, SHA256 `7F0BE5A9BBA942545FD3D368C60538AFD28FE3B86B2656BD4810CE993BB7A956`). It uses the default Electron icon. Launching `release\win-unpacked\ARAM Mayhem Wrapped.exe` in demo mode created a database with 12 matches. A clean Windows VM was not used.

`pnpm` is not on PATH. Use `corepack pnpm`. The first install failed while compiling better-sqlite3 because this machine has no complete MSVC toolset plus Windows SDK. After ignoring that build script, a clean `corepack pnpm install --frozen-lockfile` completed. The published Node-API prebuild is the binary Electron loads. The installer build skips native rebuild for the same reason.

Do not mark production acceptance complete from these rows.
