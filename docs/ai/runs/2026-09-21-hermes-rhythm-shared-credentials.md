---
date: 2026-09-21
repo: Rhythm
branch: worktree-agent-a8a0a127009ef506c
pr: null
issues: [1569, 1570]
status: investigation-complete
tags: [run, rhythm, hermes]
---

# Hermes + Rhythm: shared credentials, shared memory, in-place Hermes updates

Design investigation and issue-writing only. No product code changed, no PR, no push.
Read-only throughout: no credential value was read, printed or copied; neither `auth.json`
was modified; no vault or memory file was touched.

## Files

- Filed: #1569 — credentials / memory / one AI settings screen
- Filed: #1570 — in-place Hermes Desktop artifact updates
- Cross-linked both ways by comment.
- New label `hermes` created.

## Checks

Read-only inspection only. No tests run, no builds, no services touched.
The running app (:4001, :4096), Hermes, and the `Rhythm-colony-plan` worktree were not disturbed.

## Notes

### Where the evidence came from

`~/.hermes/hermes-agent/` ships Hermes' full Python source, so the credential and memory
behaviour below is read from source, not inferred from file layout or binary strings.
The Electron-side Hermes files live on `mega/2026-09-18-mobile-electron-hermes`, not on the
worktree branch; read via `git show <sha>:<path>`.

### Credentials

- `hermes_cli/auth.py::_save_auth_store` — read-modify-write under `~/.hermes/auth.lock`,
  atomic `O_EXCL` + rename, 0600. Unknown top-level keys survive.
- `_load_auth_store` — unparseable file is copied to `auth.json.corrupt` and returns an
  **empty** store. An outside writer that produces a malformed file costs the user every
  Hermes credential on the next save. This is the reason the recommendation is "never write
  `auth.json` from Rhythm".
- **Anthropic is already shared.** `agent/credential_pool.py::_sync_anthropic_entry_from_credentials_file`
  re-reads the external Claude Code credential for `source="claude_code"` pool entries;
  `agent/anthropic_adapter.py::read_claude_code_credentials` reads the macOS Keychain item
  `Claude Code-credentials` and `~/.claude/.credentials.json`. Rhythm's credential bridge
  already polls the same Keychain credential.
- **Env injection does not work today.** `hermes_cli/config.py::get_env_value_prefer_dotenv`
  reads `~/.hermes/.env` **before** `os.environ`, by design. That file exists (24 KB) and
  already defines `OPENROUTER_API_KEY` and `GOOGLE_API_KEY`, so Rhythm-injected values for
  the two most-overlapping providers are silently ignored. `.env` is the layer to write.
- **Dual-refresher hazard is documented upstream**, at
  `agent/credential_pool.py::_write_through_provider_state_to_global_root`: rotating refresh
  tokens across two readers produce `refresh_token_reused` / `invalid_grant`. Narrower than
  feared here only because Hermes' `anthropic` and `gemini` are api_key-typed and never
  refresh independently. Rule: share access tokens and API keys, never refresh tokens.
- `~/.hermes/shared/` is not a sharing surface — one empty lock file.
- No upstream Hermes change is required for the recommendation. Two upstream asks noted as
  nice-to-have: a `source="rhythm"` external-file sync, and a `HERMES_ENV_FILE` override.

### Memory

The premise the investigation started from was wrong and was corrected mid-run.

- Hermes' `MEMORY.md` first line already names `~/Documents/Obsidian Vault` as the core
  long-term store; `apps/api_server/src/config/env.ts:98` already documents
  `MEMORY_VAULT_PATH="~/Documents/Obsidian Vault/AGENT-MEMORY"` + `MEMORY_VAULT_SUBDIR=""`.
  Both tools were designed to converge there. Rhythm isn't reaching it — `env.ts:83`/`:613`
  fall back to `~/Documents/Memory-Vault` (89 notes) while `AGENT-MEMORY` holds 376.
  **A separate agent is fixing the path default and merging the stale notes; #1569 references
  that as in-flight and does not duplicate it.**
- So "adopt Hermes' memory into Rhythm, or vice versa" is neither. For the record:
  Hermes' store is two `§`-delimited markdown files capped at 2200 + 1375 = **3,575 chars**,
  per-profile, with **no retrieval at all** (`add`/`replace`/`remove`, substring matching,
  whole store injected as a frozen system-prompt snapshot to preserve the prefix cache).
  Rhythm's is 18 services with lexical+semantic rank fusion, a 0.60 relevance floor, link
  expansion and consolidation. Complementary, not substitutable.
- **Hermes does not write the vault programmatically.** No vault path, Obsidian reference or
  Obsidian MCP in `~/.hermes/config.yaml`; no Obsidian skill or plugin. The MEMORY.md line is
  a prompt instruction to the model. Collisions are therefore bursty and unstructured rather
  than steady — harder to design for, not easier.
- **Concurrency is the headline risk.** `memoryVaultWriteService.ts:1047` `lifecycleMutationTails`
  is an in-process JS `Map`; note writes are atomic (tmp + `fs.rename`, lines 477-499) but
  there is no advisory lock and nothing another process can observe. Hermes already uses
  `<file>.lock` sidecars plus `_detect_external_drift`. Recommendation: adopt the same
  convention on Rhythm's read-modify-write paths, add digest-drift abort, let the two note
  formats coexist, and declare `index.md`/`log.md` Rhythm-owned in an `AGENT-MEMORY/README.md`.
- The audit trail is load-bearing, not bookkeeping: `log.md` is read by
  `memory_consolidation_drafter.ts` and `memoryVaultWriteService.ts`.

### In-place Hermes Desktop updates (#1570)

- The pin is caller policy, not validator policy — `resolveHermesDesktopArtifact` enforces
  `expectedSourceCommit` only when truthy, and all five call sites pass it.
- **`integrity` is self-attesting.** It proves files match *that* manifest, not that the
  manifest came from a legitimate publisher. The artifact's `host` is `import()`-ed into the
  Electron main process, which per `apps/electron/entitlements/mac.plist` has no sandbox plus
  `disable-library-validation`, `allow-jit` and `allow-unsigned-executable-memory`. An updater
  without publisher verification is a direct RCE path. Recommended: detached Ed25519 signature
  over canonical `manifest.json` bytes, public key compiled into Rhythm, plus a monotonic
  sequence to block replay.
- **Code-signing implication confirmed and worse than expected.** The artifact is nested signed
  code — `refreshHermesDesktopArtifactIntegrity` exists to re-seal after `codesign` touches
  nested native binaries and before the outer signature. An update landing in userData must
  ad-hoc sign every native binary it unpacks, or arm64 Mach-O will not execute.
- **`electronMajor` under-specifies.** The 2026-09-19 run records alignment to *exact* 40.10.2
  for native addons. Add `electronVersion` and gate on it.
- **`hermes-protocol.mjs` versions the intent DTOs (`v: 1`) but the host module's exported
  interface is not versioned.** Add `hostApiVersion` to the signed manifest — cheapest
  addition in the issue and the one that makes independent updates survivable.
- Rollback: validation already fails closed but fails *terminally*. Needs a factory-copy
  fallback plus boot-success marking (host import AND renderer ready), or a
  validates-but-crashes artifact produces a launch loop.
- Biggest risk: shipping the convenient 20% (loosen the pin, repoint `getArtifactRoot`) without
  the inconvenient 20% (manifest signing, rollback ledger, `hostApiVersion`). Land trust first —
  the pin is currently the only thing doing that job.

### Blocked

Two permission denials, neither worked around:

1. `grep` for Keychain/credentials-file patterns against
   `apps/api_server/src/services/credentials_bridge_service.ts` and `auth_credential_watcher.ts`
   was denied twice. The Rhythm half of the "both apps read the same Keychain item" finding is
   therefore taken from the existing project description rather than re-verified here. #1569
   flags this as the first thing to confirm before building on it.
2. Writing this run log to `docs/ai/runs/2026-09-21-hermes-rhythm-shared-credentials.md` was
   refused by a deny rule ("File is covered by a Read deny rule in your permission settings").
   The content was left in the session scratchpad instead and needs to be copied into the repo
   by someone with write access to that path.
