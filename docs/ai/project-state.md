# Project State

## Current focus

2026-07-29: repair Desktop Release v0.18.53 after run
[`30490564260`](https://github.com/ajhochy/Rhythm/actions/runs/30490564260)
signed and notarized the app successfully but the stale OAuth verifier rejected
the required app-scoped `keychain-access-groups` entitlement.

## Active branch / PR

- Branch: `codex/fix-desktop-keychain-entitlement-verifier`, based on `main` at
  `125df4747`.
- Draft PR:
  [#1250](https://github.com/ajhochy/Rhythm/pull/1250).
- Run record:
  [runs/2026-07-29-desktop-keychain-entitlement-verifier.md](runs/2026-07-29-desktop-keychain-entitlement-verifier.md).

## In progress

- Monitor every check on draft PR #1250 to green.
- After a human merges the repair, dispatch a fresh v0.18.53 Desktop Release
  from the new `main`; do not rerun the failed old-SHA workflow.

## Risks / known issues

- Production API is healthy but still pinned on Synology to rollback image
  `sha-80d1552`; the repaired final-main image published successfully but has
  not yet been manually deployed.
- TestFlight upload is paused. A production iOS 1.0.8 (build 2) IPA from
  `125df4747` passed local metadata, OAuth, ATS, provisioning, and entitlement
  checks, but no upload occurred.
- A separate pre-existing `DB_CLIENT=postgres` + default `RHYTHM_ROLE=all`
  runtime error was found after healthy startup: stream status reconciliation
  calls the SQLite-only session repository. Follow-up:
  [postgres-all-role-stream-bridge-reconciliation.md](generated-issues/postgres-all-role-stream-bridge-reconciliation.md).

## Test status

- GitNexus verifier impact: LOW, zero runtime callers/processes.
- Regression test reproduced the stale rejection, then passed 13/13 after the
  repair.
- Bash syntax, ShellCheck, API lint, and diff checks passed.
- `ai-workflow checks --level issue` passed.
- `ai-workflow checks --level pr` passed every configured Flutter, API, MCP,
  opencode-fork, and mobile check/build.
- GitNexus compare-`origin/main`: LOW risk, zero affected processes.
- Server/live API, UI screenshot, and packaged-runtime smoke are N/A because
  this branch changes release validation only, not app/runtime behavior.

## Next step

Require green CI on draft PR #1250, then hand it off for human review and
merge. After merge, dispatch a new v0.18.53 Desktop Release and verify its
published artifacts before resuming the Synology API update and TestFlight
upload.
