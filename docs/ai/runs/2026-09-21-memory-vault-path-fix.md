---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: null
issues: [885]
status: done
tags: [run, Rhythm]
---

# Memory vault default repointed to the Obsidian AGENT-MEMORY vault

## What #885 actually did (and what it missed)

#885 is CLOSED and was genuinely implemented — but only on one of the two
spawn paths, exactly as its own title predicted.

It added `MemoryVaultConfigService` (Flutter), a `buildApiServerEnvironment()`
helper, a Settings "MEMORY VAULT" section, and auto-detection that prefers
`~/Documents/Obsidian Vault/AGENT-MEMORY` with an empty subdir. All of it is on
`main` (commit `4b7e5c98`) and correctly wired through `main.dart` into the
`ApiServerService` instance that `AgentServerController` actually spawns.

What it missed: **the api_server default itself**, and therefore every
non-Flutter spawner. The desktop client the user is actually running today is
the **Electron** shell, not Flutter —
`~/Applications/Rhythm Mega Desktop Candidate.app` is an Electron bundle, and
`apps/electron/src/agent-server.mjs:100` sets `AGENT_LOCAL` but never sets
`MEMORY_VAULT_PATH` / `MEMORY_VAULT_SUBDIR`. Confirmed live: the api_server on
:4001 (pid 56050, parented by the Electron app) has `PORT` and `AGENT_LOCAL` in
its environment and **no** vault vars, so it fell through to the hard-coded
`~/Documents/Memory-Vault` default and scanned the 89-note legacy vault.

Fixing the default rather than adding a second env-wiring site fixes every
spawner at once — packaged app, Electron, `npm run dev`, scripts, tests.

## Files changed

- `apps/api_server/src/config/env.ts`
  - New exported `DEFAULT_MEMORY_VAULT_PATH = '~/Documents/Obsidian Vault/AGENT-MEMORY'`
    and `LEGACY_MEMORY_VAULT_PATH` (documentation only).
  - `resolveMemoryVaultPath()` defaults to the new constant (was line 83).
  - `env.memoryVaultPath` now delegates to `resolveMemoryVaultPath()` instead of
    repeating the literal (was line 613) — one source of truth, so the two call
    sites can no longer drift apart again.
  - `resolveMemoryDirPath()` subdir default is now conditional:
    `MEMORY_VAULT_PATH` unset → `''` (kind-folders at the vault root, the #860
    clean layout); `MEMORY_VAULT_PATH` set → `'memory'` (back-compat). An
    explicit `MEMORY_VAULT_SUBDIR` still wins over both, including empty string.
- `apps/api_server/src/__tests__/memory_vault_default_path.test.ts` (new, 8 cases).

### Why the conditional subdir

Issue #803 made the subdir configurable with default `memory`. The new default
vault needs `''` (notes at `AGENT-MEMORY/<kind>/<slug>.md`), but ~the entire
test suite and every dev override points `MEMORY_VAULT_PATH` at a fixture and
relies on `<vault>/memory/<kind>/`. Keying the subdir default off "was the path
chosen explicitly?" satisfies both with no test churn: the change is a strict
no-op whenever `MEMORY_VAULT_PATH` is set.

Side benefit: this also removes the `MEMORY_VAULT_SUBDIR`-must-be-exported
footgun documented in `docs/ai/generated-issues/api-server-vitest-memory-vault-env.md`
(18 suites failing when the host did not export it) — unset + path-set now
resolves to `memory` on its own.

### Path contains a space

`~/Documents/Obsidian Vault/AGENT-MEMORY` has a space. Every consumer reaches it
through `expandHome()` → `path.join()` → `fs`, never through a shell string;
the one shell consumer (`apps/api_server/scripts/smoke_memory_authority.sh`)
takes the path as a quoted variable. A test asserts the space survives
unescaped and un-percent-encoded.

## Checks

- `npx tsc --noEmit` (apps/api_server) — PASS, exit 0.
- New contract test, red→green:
  - RED against unmodified `env.ts`: 4 failed / 4 passed (8).
  - GREEN with the fix: **8 passed / 8**.
- Full `npx vitest run` (apps/api_server) — see Notes.
- GitNexus `impact(resolveMemoryDirPath, upstream)`: **HIGH**, 12 direct
  callers / 33 impacted, modules Services (26) / Controllers (4) / Config (1).
  Accepted because the change is behaviour-identical for every caller that sets
  `MEMORY_VAULT_PATH`, which is all of them in test and dev.

## Vault migration (one-time, manual)

Pre-migration diff of the 89 legacy notes against the 376 in AGENT-MEMORY:

| Bucket | Count | Action |
|---|---|---|
| Exact duplicate (identical bytes) | 1 | skip |
| Slug collision, generated index/log files | 7 | skip (generated) |
| Slug collision, AGENT-MEMORY copy is NEWER | 1 | skip (AGENT-MEMORY authoritative) |
| Not agent memory (research archives, no `kind`) | 78 | **not migrated — see below** |
| Genuine unique agent-memory notes | 2 | **migrated** |

Migrated (copied, `cp -n`, byte-identical):

- `memory/context/2026-09-21-ai-trend-scan-archived-cloudflare-security-audit.md`
  → `AGENT-MEMORY/context/…` (written TODAY — direct proof the app was still
  writing into the stale vault)
- `memory/preference/i-prefer-tuesday-afternoons-for-deep-work.md`
  → `AGENT-MEMORY/preference/…`

AGENT-MEMORY: 376 → 378 notes. `~/Documents/Memory-Vault` re-hashed after the
copy — all 89 checksums identical, nothing added, modified or deleted.

### Why 78 notes were NOT migrated

76 under `Resources/Tech-AI-Research/` and 2 under `Areas/` are **web-research
archives**, not agent memory: no `kind` frontmatter, so by the vault's own
`<kind>/<slug>.md` contract they have no destination in AGENT-MEMORY. They were
produced by the "archive research sources to Obsidian" standing instruction and
belong in the **main** Obsidian vault, which already has
`Resources/Tech-AI-Research/` and `Areas/Research/`. Importing them would also
violate `env.ts`'s own constraint that `MEMORY_VAULT_PATH` stay scoped to a
dedicated agent-memory dir — the index scanner reads it recursively, so 78
kind-less clippings become 78 junk index rows.

Checked against the main vault: 72 of the 78 are absent from it entirely and 6
exist under the same filename with different content. Relocating them is a
separate decision on the user's real vault and was left for him.

### Index files

`AGENT-MEMORY/index.md`, the per-kind `index.md` files and `log.md` were NOT
touched, and the stale legacy copies were NOT copied over them. They are
regenerated deterministically from a disk scan by
`regenerateMemoryVaultNavigation()` (`memory_vault_index_writer.ts`) on the next
memory capture or SQLite index rebuild, so they self-heal. They were already
months stale (`log.md` ends 2026-07-27) because capture had been going to the
wrong vault; hand-patching two counts would have implied a freshness they do not
have.

## Notes

- Obsidian was running during the migration. Only two NEW files were created and
  no existing file was opened for write, so there was no lock contention.
- **The packaged app will not pick this up until it is rebuilt.** The running
  app, its api_server on :4001 and the engine on :4096 were deliberately left
  running and untouched.
- Pushed to `mega/2026-09-18-mobile-electron-hermes`, no PR, not merged.
