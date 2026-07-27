# Project State

## Current focus

Hand off the live-verified provider-stream inactivity recovery for #1211.

## Active branch / PR

- Branch: `codex/issue-1211-stalled-stream`.
- PR: [#1212](https://github.com/ajhochy/Rhythm/pull/1212) (draft only; do not merge).
- Issue: [#1211](https://github.com/ajhochy/Rhythm/issues/1211).
- The config-doctor work remains in draft PR #1207 and is outside this branch.
- The separate MEM-OKF PR #1205 remains outside this branch and may require a
  project-state reconciliation if both branches land.

## In progress

- Keep draft PR #1212 unmerged pending human review/manual smoke.

## Risks / known issues

- GitNexus rated the edited LLM stream and delegated-task paths LOW risk.
- The 180-second default is intentionally provider-boundary inactivity, not a
  whole-turn deadline; long-running tools are unaffected.
- Fork typecheck still reports three pre-existing errors in
  `src/bus/global.ts` and `test/file/path-traversal.test.ts`.

## Test status

- `ai-workflow checks --level issue`: PASS (Flutter analyze/format, API tsc).
- `ai-workflow checks --level pr`: PASS.
- Fork focused suite: PASS, 34/34; fork full suite: PASS.
- API full suite and build: PASS.
- Acceptance contract: PASS, 6/6.
- Fork single-binary build/smoke: PASS.
- Foreground sandbox stalled-provider contract: PASS, 1/1.
- Sandbox health and engine-health probes: PASS; ports 4097/4098 clear after
  teardown.

## Next step

Human review and manual smoke of the #1211 draft PR; do not merge
automatically.
