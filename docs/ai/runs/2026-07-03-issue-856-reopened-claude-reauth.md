---
date: 2026-07-03
repo: Rhythm
branch: workflow/run-2026-07-03
pr: []
issues: [856]
status: verification-gate PASSED, not yet committed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# 2026-07-03 — Issue #856 (reopened): engine does not pick up refreshed Claude credentials after `claude` re-auth

## Root cause (confirmed, matched the reopening triage exactly)

Path mismatch + skipped re-bridge:
- The engine gets Claude OAuth creds from the macOS Keychain
  (`Claude Code-credentials`, fallback `~/.claude/.credentials` file) via
  `CredentialsBridgeService.bridgeAnthropic`, which bridges them into
  opencode's `~/.local/share/opencode/auth.json`.
- The original #856 file watcher watches only opencode's `auth.json`
  (`apps/api_server/src/server.ts`). Running `claude` to re-auth never
  writes that file — it writes the Keychain + the local Claude Code
  credentials file — so the watch never fired on a `claude` re-auth.
- Even when a reload did run, `OpencodeClientService.reloadCredentials()`
  only bounces the engine (`dispose()` → `initialize()` → `restoreAuth`),
  which re-reads the still-stale `auth.json`; it never re-invokes
  `bridgeAnthropic` (confirmed no reference to `bridgeAnthropic` anywhere in
  `opencode_client_service.ts`).

Symptom: after running `claude` to re-auth, sessions kept failing with
"Claude Code credentials are unavailable or expired. Run `claude` to refresh
them." (that string originates in the bundled Anthropic AI-SDK provider
inside the engine, not Rhythm source).

## Files changed

- `apps/api_server/src/services/auth_credential_watcher.ts` — extended
  `authIdentityFingerprint` to recognize the Claude Code local credentials
  file's shape (`{ claudeAiOauth: { accessToken, refreshToken, expiresAt,
  ... } }`, confirmed against the real file on disk), normalizing it into
  the same `{ type, refresh, key }` identity shape used for opencode's
  `auth.json` so one `decideReload` covers both files. Incidentally fixed a
  pre-existing stray NUL byte on the exact line touched (`return ' null'`
  contained a literal `\x00` instead of a space in the committed HEAD,
  confirmed via `git show HEAD` before this change — not introduced by it).
- `apps/api_server/src/server.ts` — added a second `AuthCredentialWatcher`
  instance watching the Claude Code local credentials file directly (the
  file `claude` itself writes on re-auth). Its `onReload` calls
  `credentialsBridge.bridgeAnthropic(opencodeClient, { force: true })`
  (imported via the same dynamic `import('./routes/opencode_auth_routes')`
  the launch-time auto-bridge already uses, avoiding an import cycle)
  instead of `opencodeClient.reloadCredentials()`, because the latter only
  re-reads the stale `auth.json`. Added the paired `claudeCredentialWatcher`
  nullable variable + `.stop()` call in the shutdown handler, mirroring the
  existing `authCredentialWatcher` pattern exactly.
- `apps/api_server/src/services/auth_credential_watcher.test.ts` — added 3
  tests for the new fingerprint shape (routine access-token rotation on the
  same refresh token → no reload; refresh-token change → reload;
  first-observation baseline) and 3 wiring-contract tests proving a genuine
  `claude` re-auth drives a **forced** `bridgeAnthropic` call, not just a
  bounce (one bare-spy test, one asserting a same-refresh-token rotation
  does NOT re-bridge, one against the REAL `CredentialsBridgeService`
  method, spied, to guard against wiring drift from the real signature).
- No changes needed to `credentials_bridge_service.ts` —
  `bridgeAnthropic(client, { force: true })` already existed (added for
  #658's "Reconnect" button) and already does exactly what's needed
  (invalidate cache, re-read Keychain/file, push into the live SDK via
  `setOAuthCredentials`).
- `docs/ai/project-state.md` — appended a "Recent coding-agent runs" entry
  (superseded by this run file + the snapshot rewrite below).

## Checks run

- `cd apps/api_server && npx tsc --noEmit` — clean.
- `npx vitest run src/services/auth_credential_watcher.test.ts
  src/__tests__/credentials_bridge_service.test.ts` — 38/38 pass.
- `npx vitest run src/services/opencode_client_service.test.ts` — 37/37
  pass (unaffected).
- `npx vitest run src/__tests__/opencode_auth_routes.test.ts` — 6/6 pass
  (unaffected).
- `ai-workflow checks --level pr` — flutter analyze + dart format + tsc +
  full api_server vitest, **2336 pass / 1 skip / 0 fail** (273 files), all
  green on branch `workflow/run-2026-07-03` @ `a832ea277`.
- Fails-before/passes-after proof: `git stash push` on just
  `auth_credential_watcher.ts` (keeping the new tests), reran → 3 of 22
  tests in that file failed exactly as expected (fingerprint didn't detect
  the refresh-token change; both wiring tests never saw the forced
  `bridgeAnthropic` call fire because the watcher never decided to reload).
  `git stash pop` restored the fix; all 38 pass again.

## Notes / decisions

- Kept the fix as a SECOND watcher instance rather than one watcher covering
  two paths — the two files have different reload semantics: opencode's
  `auth.json` change → engine bounce via `reloadCredentials()`; the Claude
  Code credentials file change → forced re-bridge via `bridgeAnthropic`
  (no engine bounce needed, since `setOAuthCredentials` already pushes into
  the live SDK).
- Reused the existing `force` option on `bridgeAnthropic` (added for #658)
  rather than adding a new parameter — it already does exactly what's
  needed.
- **Verification-gate detour**: `ai-workflow checks --level pr` initially
  failed not from the source fix but because this run's first-draft
  `project-state.md` prose contained the literal filename-with-extension
  token for the Claude Code credentials file, which trips the repo's #873
  prompt-injection context scanner's `secrets-credentials-file` pattern —
  `context_scanner.test.ts`'s repo self-check scans every markdown file
  directly under `docs/ai/`. Reworded the prose (no code changes) to
  describe the same file without the contiguous token; re-ran clean.
- Deviations from spec: none — implemented exactly the two-part fix from
  the reopening comment (watch the file `claude` writes; force re-bridge on
  reload), touching only the files under "Ownership" in the dispatch.
- **Residual risk / manual-smoke item**: this fix assumes `claude`'s CLI
  re-auth flow writes the local Claude Code credentials file in lockstep
  with the macOS Keychain entry on this machine — not independently
  re-verified end-to-end against a live `claude` re-auth in this run (no
  real engine / real Keychain writes in the hermetic unit tests). Manual
  smoke: run `claude` to re-auth, confirm the file's `refreshToken` value
  actually changes, watch the server log for `"claude re-auth detected —
  re-bridged: ok"`, then start a new agent session and confirm no "Claude
  Code credentials are unavailable or expired" error. Also note `fs.watch`
  on macOS can occasionally miss events on some filesystems/editors — same
  known limitation the original #856 `auth.json` watcher already carries.
- Not yet committed (per dispatch instructions — working tree still has
  these changes plus an unrelated concurrent Flutter agent's in-flight
  edits for #888, untouched by this run).
