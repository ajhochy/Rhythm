# Project State

## Current focus

Open-PR merge train complete. All previously-open PRs are merged into `main`;
zero open PRs remain.

## Active branch / PR

- Branch: `main` at `4259320f5` (post-merge).
- No open PRs.

## In progress

- Nothing. The 9-PR backlog from the 2026-07-16 Codex handoff is fully landed.

## Recently merged (2026-07-16)

- #1104 (#1038 dark-theme Projects) and #1106 (#1082 skill-revert byte-safe) — merged by the prior Codex session.
- #1100 (#1091 gemini anyOf sole-key), #1101 (#1089 cron timezone), #1102 (#1083 NULL MCP scope insert-only),
  #1103 (codex gpt-5.6-sol route), #1095 (#1093 hybrid Engraph memory retrieval),
  #1105 (#1001 live-E2E isolation guard), #1107 (#1041 prompt-fix resolver fallback) — this session.
- Each remaining PR was rebuilt as a single clean commit on current `main`, dropping the shared
  pre-squash #1097 noise that would otherwise have reverted `project-state.md` and re-added divergent
  manager-routing files on squash-merge.

## Risks / known issues

- #1100's fix lives in `apps/opencode_fork` (no fork CI in this repo). Source fix is unit-tested
  (bun test 12/12); the shipping app uses a pre-built fork binary, so a release build must rebuild
  the fork to pick it up.
- Codex's speculative hardening (allowed_mcps_state provenance column, path confinement) was
  deliberately NOT adopted — Codex itself flagged it HIGH blast radius; the PRs' own targeted fixes
  are sufficient and covered by tests.

## Test status

- Final merged `main`: `npm run build` clean, full unit suite 2769 passed / 32 skipped, 0 failures
  (baseline was 2728; +41 from the merged PRs' tests).
- Release smoke (`apps/api_server/scripts/smoke-launch.sh`) on merged `main`: PASS — build + spawn +
  bind :4001 + /health + /agents/capabilities 200 + POST /agent-sessions 201, isolated temp DB.
- All 6 api_server PRs passed `server-checks` CI on their pushed SHAs; #1100 validated locally (no fork CI).

## Next step

Trigger a desktop release build (increment patch from latest tag) when ready to ship; the release
build rebuilds the bundled Node server and the opencode fork binary (needed for #1100 to take effect).

## Recent coding-agent runs

### 2026-07-16 — #1067 (OCU-26, Cluster D): fork openapi.json + SDK regen
- Worktree: `/Users/ajhochhalter/Documents/Rhythm-wt/cluster-d`, branch `epic1116/cluster-d-fork-sdk`.
- Files modified:
  - `apps/opencode_fork/packages/sdk/openapi.json` — canonical spec regen (131 → 133 ops); `packages/docs/openapi.json` picks it up via symlink, no separate edit needed.
  - `apps/opencode_fork/packages/sdk/js/src/v2/gen/sdk.gen.ts` — adds typed `Skills.reload`/`Config.reload` methods (`POST /skill/reload`, `POST /config/reload`); existing `Config`/`Config2`/`Config3` classes mechanically renumbered to `Config`(new)/`Config2`/`Config3`/`Config4` by the codegen's collision resolution (not hand-edited).
  - `apps/opencode_fork/packages/sdk/js/src/v2/gen/types.gen.ts` — adds `AppSkillsReload*`/`AppConfigReload*` types; adds `mcpAllowlist`/`skillAllowlist` optional fields to `Session`, `session.create`, `session.update` types.
  - `docs/ai/decisions/2026-07-16-fork-sdk-regen-offline-and-legacy-gen-scope.md` — new decision doc (see below).
- Checks run:
  - `bun install` (fork root, first-time — node_modules was absent) — pass, 4659 packages.
  - `bun run typecheck` in `packages/sdk/js` — **pass**, 0 errors.
  - `bun run typecheck` in `packages/opencode` — **fails**, but on a single **pre-existing, unrelated** error (`src/bus/global.ts:16` `EventEmitter` generic-variance error). Confirmed via `git diff main -- .../bus/global.ts` (zero diff) and `git log` (file unchanged since the initial vendor-import commit `f0981434b`) — not introduced by this change, not in scope to fix.
  - `bun test test/session/ src/session/` in `packages/opencode` — **pass**: 366 pass / 4 skip / 1 todo / 0 fail, 944 expect() calls, 371 tests across 21 files (exceeds the plan's "325+" bar).
  - `bun run build --single` in `packages/opencode` — **pass**, exit 0. Built the embedded web UI (vite), installed multi-platform native deps for `@opentui/core`/`@parcel/watcher` (no tracked-file side effects — checked `git status` after, only the 3 intended files show as modified), compiled `dist/opencode-darwin-arm64/bin/opencode`, and its built-in smoke test passed (`opencode --version` → `0.0.0-epic1116/cluster-d-fork-sdk-202607162056`). No rc=137/OOM.
- Decisions made: see `docs/ai/decisions/2026-07-16-fork-sdk-regen-offline-and-legacy-gen-scope.md` — (1) the real generator (`bun dev generate`, i.e. `packages/opencode/src/cli/cmd/generate.ts`) runs fully offline (pure function over static route defs, no live server needed), correcting a prior 2026-07-06 decision's premise that regen wasn't possible offline; (2) only `src/v2/gen` has an active generator in this fork (one `createClient()` call, `packages/sdk/js/script/build.ts`) — legacy `src/gen` (default `@opencode-ai/sdk` export) has none and was deliberately left untouched (inert — nothing in Rhythm imports it yet); (3) skipped root `script/generate.ts`'s trailing repo-wide `prettier --write .` since the CLI generate handler already pre-formats `openapi.json` identically.
- Deviations from spec: plan's Files list named both `src/gen/` and `src/v2/gen/` as candidates; only `src/v2/gen` was regenerated (see decision doc for why — no generator exists for legacy `src/gen`, and it's confirmed inert).
- Concerns: `packages/opencode`'s `bun run typecheck` does not exit 0 as a whole (pre-existing unrelated failure) — if a downstream gate literally greps for that command's exit code repo-wide rather than per-package, it will report failure for a reason unrelated to this issue. `packages/sdk/js` typecheck (the package actually changed) is clean.
