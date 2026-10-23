# Portable launcher verification

Verified on Windows in this development environment on 2026-10-23:

- Fresh portable Node 22.20.0 downloaded from nodejs.org and SHA-256 verified.
- pnpm 10.18.2 downloaded from npmjs.org with SHA-512 SRI verification.
- A clean source directory with no node_modules installed its frozen dependency graph using the portable Node/pnpm, with lifecycle scripts disabled.
- SQLite native smoke test returned ok with Node-API 10.
- InstallOnly exited successfully. This does not claim a clean Windows VM, installed-system updater or remote main-branch deployment test.

The launcher uses per-user portable files, never changes execution policy or requires elevation, and separates demo data. A direct .ps1 invocation can be restricted by local execution policy; the documented ScriptBlock command runs the visible script without changing system settings. No Git executable is needed. Source is downloaded from the repository ref only after the owner uploads it. The remote main URL is not yet published or verified.

The browser host opens only loopback. Native League discovery and complete historical coverage are separate capabilities; a successful bootstrap does not prove every prior match is available.
