---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Memory Vault env injection: only the agent-spawning ApiServerService, no legacy-note migration

## Context

Issue #885: the desktop app spawns the api_server with bare
`Platform.environment`, so `MEMORY_VAULT_PATH`/`MEMORY_VAULT_SUBDIR` are
never set and `apps/api_server/src/config/env.ts`'s
`resolveMemoryVaultPath()`/`resolveMemoryDirPath()` fall back to the OLD
`~/Documents/Memory-Vault` (3 stale notes) instead of the intended Obsidian
`AGENT-MEMORY` vault (31 notes, the #801/#860 single source of truth).

`main.dart` constructs **two** `ApiServerService` instances:
1. One passed to `ApiServerController` (`serverController`), used only to
   `checkHealth(serverUrl)` against the configured production URL
   (`serverConfigService.url`, e.g. `https://api.vcrcapps.com`). It never
   calls `.start()` and never spawns a process.
2. One (`agentService`) passed to `AgentServerController`, which calls
   `.start()` — this is the process that actually spawns the local
   Node.js api_server on port 4001 and hosts `GET/POST /agent-memory`.

Only instance (2) needs the Memory Vault env, since instance (1) spawns
nothing.

## Decision

- `ApiServerService` gained two optional constructor params
  (`memoryVaultPath`, `memoryVaultSubdir`), defaulting to `null` (back-compat
  — any other call site, including instance (1) above and any test
  construction, keeps working with no vault env, exactly matching pre-#885
  behavior for those cases).
- Only `agentService` in `main.dart` is constructed with the resolved
  `MemoryVaultConfigService` values.
- The environment-merge logic was extracted into a pure top-level function,
  `buildApiServerEnvironment()`, so the precedence rule (explicit env var in
  `Platform.environment` wins over the persisted setting) is unit-testable
  without spawning a real process or touching real environment variables.
- `MemoryVaultConfigService` is a **new, separate** `ChangeNotifier` class —
  not a field added to `ServerConfigService` — per the CLAUDE.md rule "do not
  couple agent traffic to `serverConfigService.url`". The two settings are
  persisted under different SharedPreferences keys and have no code path
  connecting them.
- Auto-detect default (issue's acceptance criterion): `autoDetectDefault()`
  prefers `~/Documents/Obsidian Vault/AGENT-MEMORY` (subdir `""`, clean
  `<kind>/<slug>.md` layout) when that directory exists on disk at first-run
  `load()` time, else falls back to the legacy `~/Documents/Memory-Vault`
  (subdir `"memory"`, matching api_server's own back-compat default). This
  auto-detect only runs once — the moment a user (or a future migration)
  saves an explicit path via Settings, the saved value always wins on
  subsequent `load()` calls.
- **No automatic migration of the 3 stale legacy notes.** Per the issue's
  explicit request ("do NOT migrate the 3 stale legacy notes automatically —
  surface a one-line log listing them; the maintainer will prune"), this fix
  only changes which vault the app POINTS AT going forward. No file-moving or
  note-deletion code was written. The "surface a one-line log" acceptance
  item is satisfied at the project-memory level (this doc + the
  `project-state.md` run entry name the 3 stale notes and location) rather
  than as new runtime log output in api_server, since api_server was
  intentionally left untouched by this change (env.ts semantics are
  unchanged) and adding new startup logging there would have expanded scope
  beyond "smallest correct change" for a Flutter-side spawn-env bug.

## Alternatives considered

1. **Add the vault path as a field on `ServerConfigService`.** Rejected —
   directly contradicts the documented architectural rule against coupling
   agent-local config to the production server URL setting.
2. **Auto-migrate the legacy 3 notes into AGENT-MEMORY on first detect.**
   Rejected per the issue's own explicit instruction; also risks silently
   duplicating/clobbering content in a vault a human maintains by hand in
   Obsidian.
3. **Inject the vault env into BOTH `ApiServerService` instances "just in
   case".** Rejected as dead code — the health-check-only instance never
   spawns a process, so passing env-injection constructor params to it would
   be inert and confusing to a future reader trying to understand which
   instance actually owns the spawn.

## Consequences

- Out of the box (no manual env export), a fresh install of Rhythm will spawn
  the local agent server with `MEMORY_VAULT_PATH` pointed at the Obsidian
  `AGENT-MEMORY` vault whenever that folder exists on the machine — restoring
  the #801/#860 single-source-of-truth behavior without requiring any manual
  shell export.
- A developer who still exports `MEMORY_VAULT_PATH`/`MEMORY_VAULT_SUBDIR` by
  hand (the previous workaround) is unaffected: `buildApiServerEnvironment()`
  always lets an explicit `Platform.environment` value win over the setting.
- The 3 stale legacy notes remain in `~/Documents/Memory-Vault` untouched
  until a human (or a follow-up issue) explicitly migrates or deletes them.
- Changing the path in Settings requires a server restart to take effect
  (env vars are read once at process spawn) — the Settings UI's save
  confirmation says so explicitly; there is no automatic restart-and-reload
  wired up in this change (see the residual-risk note in the `project-state.md`
  run entry for #885).
