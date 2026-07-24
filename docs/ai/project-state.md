# Project State

## Current focus

**Mega orchestration run complete** — 10 issues resolved/partial, on draft
[PR #1158](https://github.com/ajhochy/Rhythm/pull/1158), awaiting AJ's manual
smoke + merge.

## Active branch / PR

- `mega/run-2026-07-23` → PR #1158 (draft), pushed to origin.
- Issue branches merged into it (each in its own worktree under
  `~/Documents/rhythm-worktrees/run0723-*`): `fix/1133-realpath-authz`,
  `fix/1134-email-injection-gate`, `fix/1135-disabled-agent-projection`,
  `feat/1137-attach-any-file`, `fix/1152-skill-create-resolver`,
  `fix/1153-cwd-banner`, `fix/1154-unknown-mcprole`,
  `fix/1156-delegated-permission-gate`, `feat/1096-engraph-manager-wp1`,
  `feat/1132-fork-sdk-types`.

## In progress

- Resolved: #1133, #1134, #1135, #1137, #1152, #1153, #1154, #1156.
- Partial:
  - **#1096** — WP1 already shipped earlier via #1130; this run fixed the 3
    env-dependent Engraph discovery test failures. WP2 (Settings UI) remains
    open.
  - **#1132** — interim d.ts shim shrink (903→660 lines, type-only). Full
    fork-SDK-dist fix deferred to a fork-rebase-boundary PR — see
    `docs/ai/decisions/2026-07-24-1132-interim-sdk-shim.md`.
- Skipped with reasons: #1037 (exploration, no implementation — scope choice
  for AJ), #1068 (superseded by #1132's remaining goal), #1076
  (tracking-only), #1123 (spike blocked on OCU-05/16/17/18).

## Risks / known issues

- **#1134** approval gate depends on the `/agent-approvals` list-endpoint
  shape — worth a second look if that endpoint changes.
- **#1154** packaging step (`.mcp-roles` copy in `desktop_release.yml`) is
  only verifiable on a real release build, not in sandbox e2e.
- **#1132** full flip still pending — d.ts drift risk remains until the fork
  rebase PR lands.

## Test status

Gate PASS on mega HEAD (`5b90d462d`):
- api_server `vitest`: 3140 passed / 18 failed (= pre-existing `memory_*`
  vault baseline only; the 3 Engraph PATH baseline failures from earlier runs
  are now fixed).
- mcp_server: 96/96.
- Flutter: `flutter analyze --no-fatal-infos` exit 0; `flutter test` 976/976.
- Live e2e: #1133 (2/2), #1135, #1152, #1156 all PASS against sandbox `:4098`.
- Full evidence: `docs/ai/runs/2026-07-23-mega-run-1037-1156.md`.

## Next step

1. AJ manual smoke (`docs/testing/manual-smoke.md`).
2. Merge PR #1158.
3. Clean up `run0723-*` worktrees (needs AJ approval).
4. Follow-ups: #1096 WP2 (Settings UI), #1132 full fix at fork rebase, #1135
   item-3 (`locked`/`disabled_reason` enhancement).
