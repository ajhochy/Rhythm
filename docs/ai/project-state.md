# Project State

## Current focus

**PR #898 (`feature/dual-anthropic-accounts`) — dual Anthropic accounts (team +
personal Pro) in the opencode integration. Implementation + verification gate +
manual smoke ALL complete. Still DRAFT — AJ merges manually when ready.**

- One engine + a vendored `rhythm-anthropic-accounts` plugin (from
  `opencode-claude-auth@1.5.3`, MIT) routes every Anthropic request per session via
  `x-session-affinity` → Rhythm-owned accounts store; automatic in-place failover on
  quota exhaustion with a `session.spillover` WS event.
- api_server owns the store (single writer: refresh-token rotation), in-app PKCE
  OAuth (`/opencode/auth/accounts*`), session→account resolution (body → profile
  default → app default), spillover intake, a tappable header-badge switcher
  (added mid-smoke, commit `b6470f92c`).
- Flutter: account slots + connect dialog (agent settings sheet), profile default,
  new-session override, header badge (tappable), spillover toast/marker.
- Migration: first boot imports the existing Claude Code keychain credential as
  account #1; keychain poll retires once the store has accounts.

**Manual smoke — all 4 checklist items passed 2026-07-04:**
1. Simultaneous sessions on both accounts — confirmed at the wire via the plugin's
   own debug log (`fetch_credentials` alternating `team`/`personal` across live
   sessions), not just the UI.
2. Profile default account — pass.
3. Tappable badge switcher — pass.
4. Live spillover drill (`RHYTHM_FORCE_SPILLOVER=team`) — full pipeline proven:
   `fetch_forced_spillover team→personal` → real Anthropic 200 on personal's token
   → `[Spillover] session … moved team → personal` → routing persisted → WS event.

**Two bugs found during smoke, both filed (neither caused by this PR — confirmed
by the account plugin's debug log showing the crash happens before any
network/token call):**
- **#899** — new agent profile can't set `defaultAnthropicAccountId` at create
  time, only after a save→edit round trip (known simplification, now tracked).
- **#900** — orphaned duplicate `agent_configs` row ("AI Trend Researcher",
  UUID id) has no `.md` agent file on disk → any session routed to it crashes
  with `UnknownError: UnknownError` (opencode fork's `NamedError.Unknown`
  swallows its own message). Workaround applied live (repointed the affected
  user's `SharedPreferences default_agent_ocagent` to the working duplicate).
  Root-caused to `agent_profile_sync.ts:754` only re-projecting `secretary`'s
  file on every sync tick, not self-healing missing files for other profiles.

## Active branch / PR (open — never auto-merge)

- **#898** `feature/dual-anthropic-accounts` → main. DRAFT, smoke-clean. AJ's call
  to un-draft and merge.
- **#899**, **#900** — new issues from smoke, not yet scheduled.
- **#887** `workflow/run-2026-07-03` — prior run's closeout, was open for review
  before this run.

## In progress / next step

1. AJ decides when to un-draft/merge #898.
2. After merge: release build — bundling of `opencode_plugins/` was added to
   `desktop_release.yml`; verify it survives a real release CI run.
3. #899 / #900 are small, unscheduled follow-ups.
4. Local dev server currently running clean (no `CLAUDE_AUTH_DEBUG`, no
   `RHYTHM_FORCE_SPILLOVER`) on `apps/api_server` with correct `DB_PATH` +
   `MEMORY_VAULT_PATH` env — started manually this session behind the app;
   will die when this session ends. AJ's normal `flutter run -d macos` launch
   spawns its own correctly-configured server automatically (see
   [[memory-vault-env-required-at-launch]] for the env-mismatch trap this
   session hit and fixed twice).

## Risks

- Fork/plugin drift: vendored plugin tracks `opencode-claude-auth@1.5.3`; upstream
  transform changes need a re-vendor. Routing tests import the real vendored
  module and will catch load failures.
- #900's underlying duplicate-profile creation path is still unidentified —
  the orphaned row itself was not deleted, only worked around for one user.

## Test status

api_server 2390 passed / 1 skipped (279 files, includes the badge-switcher
follow-up); Flutter analyze at 269-info baseline; macOS debug build green; full
live manual smoke green including the real spillover pipeline end-to-end.
