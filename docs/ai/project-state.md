# Project state

## Current focus

One integration branch only. All open work is consolidated into mega PR #1594; `main` plus that mega branch are the only branches (local and GitHub) and the only worktree is the main checkout.

## Active branch / PR

`mega/2026-09-29-electron-orgreviewer` → draft PR #1594 against `main`. It carries the local decision engine, router curation, the System One (Kev / Jev) routing backend (#1596, closed into it), the Electron fixes and the Rhythm MCP bundle and sign-in install (#1597), mobile streaming, and Org Reviewer paging. Deleted branch tips can still be reached from the local tag `archive/branch-consolidation-2026-09-29` (run log: `docs/ai/runs/2026-09-29-branch-consolidation.md`).

## In progress

- CI on #1594 for the consolidated head.
- Manual smoke per the #1594 checklist, including the System One backend (Kev running: `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009`; recommended rollout `first_prompt` scope, Shadow for a week, then On — `docs/ai/decision-engine-setup.md`) and the packaged Electron rhythm MCP after sign-in.

## Risks / known issues

- **Kev cold latency**: 2.8–4.2 s for the first calls after other heavy work; under the 1000 ms default those prompts time out and keep the baseline route (logged as `timeout`).
- Electron `issue-1402` packaging test needs `RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR`; only the release workflow supplies it, so the MCP bundling is not covered by PR CI.
- Local env: `native_runtime_guard` fails under Node 24.21 + better-sqlite3 12.8; `apps/mobile/node_modules` is missing `expo-image-picker` (breaks local mobile lint + web e2e; CI installs fresh).
- Carried: `issue-1387` mobile tests base-red (offline-mirror hydration); #1586 silent session stalls still open.

## Test status

Consolidated head 7b0cba74: api_server + web tsc clean; api_server decision/router/MCP vitest 239 passed; mobile router settings jest 32/32; `ai-workflow checks --level pr` green except the three local-env failures above.

## Next step

AJ smoke-tests PR #1594 and merges it to `main` manually.

## Consolidation 2026-09-29

### Temp-directory cleanup integration (2026-10-01)

- AJ requested folding draft #1602 (`ef126cd7`) into mega draft #1598 as a squash commit; #1602 is superseded after the mega push. No merge into `main` is authorized.
- Cleanup local draft verification passed: Vitest run-owned parent/per-file isolation covers passing, failing, all-skipped and concurrent runs; fork initialization-failure cleanup preserves successful disposal. Existing leftovers remain untouched.
- The unknown-cause queued-loop assertion remains narrowly AJ-waived, not fixed. The installed SQLite dependency mismatch and base/branch background temp recreation remain disclosed; downstream CI and human review are pending.
- Integration uses a clean isolated worktree; unrelated mobile edits in the main checkout are not included. Prior behavioral evidence applies to identical cleanup implementation blobs, not a blanket mega-suite PASS.

Supersedes the "Active branch / PR" section above: the integration branch is now `mega/2026-09-29-consolidation` -> draft PR https://github.com/ajhochy/Rhythm/pull/1598 (tracking issue #1599; Server CI smoke flake #1600). #1594 is superseded by it.

- **Folded**: `mega/2026-09-29-electron-orgreviewer` `ac887bb0` (merge `b846fdcc`, tree identical); `refs/clone/rhythm-1505a/mega/2026-09-18-mobile-electron-hermes` `9c255b64` (already an ancestor of the previous).
- **Dropped** (bundle `~/Documents/.consolidation-backups/rhythm-2026-09-29.bundle`; clone also in `rhythm--rhythm-1505a-9c255b64-2026-09-29.bundle`):
  - `refs/clone/rhythm-1505a/codex/1505a-better-sqlite3-13` `498c1ed6`: superseded by `98874481` on `main` (#1505 closed; the touched files are identical here).
  - `stash-backup/0-2026-09-29` = `stash@{0}` `0704cba5`: regenerated screenshots (14 PNGs, 4 already newer here) plus a stray `.pyc` and unrelated JSON; not merged because the repo is public.
- **In flight**: none. No linked worktrees. Standalone clone `/private/tmp/rhythm-1505a-9c255b64` (1.3G) is left in place as a deletion candidate.
- **Cleanup script** (reviewed and run by the owner, not yet run): `~/Documents/.consolidation-backups/cleanup/rhythm-2026-09-29-cleanup.sh`. It closes #1594, deletes `mega/2026-09-29-electron-orgreviewer` locally and on GitHub, prunes `origin`/`plugin`, clears the stash and the `stash-backup`/`refs/clone` refs.
