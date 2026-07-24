---
date: 2026-07-23
repo: Rhythm
branch: fix/1133-realpath-authz
pr: (pending)
issues: [1133]
status: implemented-pending-live-run
tags: [run, rhythm, security]
---

# #1133 — canonicalize filesystem paths before containment authorization (CWE-59/CWE-22)

## Summary

All project-containment checks (agent tools, the engine's experimental HTTP
file endpoints, and the api_server's session file proxy / worktree routes)
compared paths **lexically** (`path.relative`/`startsWith`), never resolving
symlinks first. A symlink living *inside* an allowed root but pointing
*outside* it passed every check. Fixed once at the containment primitive
(`containsReal`) in both the fork core and api_server, rather than patching
each of the 8+ call sites individually.

## Files

**Fork (`apps/opencode_fork`)**
- `packages/core/src/filesystem.ts` — new `canonicalize()` (realpath,
  fail-closed on EACCES/ELOOP/dangling-symlink; walks to the nearest existing
  ancestor for a not-yet-created write target) + `containsReal(parent, child)`
  (canonicalizes both sides before comparing).
- `packages/opencode/src/project/instance-context.ts` — `containsPath` (the
  actual choke point behind all 8 tools + the HTTP `File.read`/`File.list`
  endpoints) now calls `containsReal` instead of the lexical `contains`.
- `packages/opencode/src/reference/reference.ts` — `containsReferencePath`
  (the reference-repo bypass check `read.ts`/`grep.ts` consult before the
  containment check) now uses `containsReal` too, closing the "ordering bug"
  (a raw/uncanonicalized path satisfying the bypass) at the source instead of
  requiring every caller to pre-canonicalize.
- `packages/opencode/src/tool/read.ts` — comment only; no behavior change
  needed once `reference.ts` canonicalizes internally (see Deviation below).
- Tests: `packages/core/test/filesystem/filesystem.test.ts` (containsReal unit
  tests), `packages/opencode/test/tool/external-directory.test.ts`,
  `packages/opencode/test/tool/read.test.ts`, `packages/opencode/test/tool/shell.test.ts`,
  `packages/opencode/test/file/path-traversal.test.ts` — symlink-escape +
  no-false-lockout cases added to each.

**api_server**
- NEW `src/utils/path_containment.ts` — `canonicalize`/`containsReal`, mirrors
  the fork's core algorithm (kept in sync manually, documented in the file).
- `src/controllers/agent_sessions_controller.ts` — `resolveSessionDir` uses
  `containsReal` instead of `path.resolve` + `startsWith`. Diff confined to
  this one method; did not touch the `listAgents` registry section (~207-224,
  owned by #1135's agent).
- `src/routes/opencode_worktrees_routes.ts` — new `requireContainedWorktreeDir`
  validates `worktreeDir` is actually inside `directory` (realpath-canonicalized)
  before proxying to the engine's destructive remove/reset endpoints.
- Tests: NEW `src/__tests__/path_containment.test.ts`; symlink-escape cases
  added to `src/__tests__/opencode_worktrees_routes.test.ts` and
  `src/__tests__/issue_1060_file_find_proxy.test.ts`.
- NEW gated live test: `src/__tests__/live_e2e_1133_symlink_escape.test.ts`
  (skips unless `RHYTHM_LIVE_E2E=1`; targets the dev sandbox on :4098).

## Contract deviation (and why)

The plan's read.ts row said to canonicalize the target *in read.ts* before
both the `reference.contains` bypass check and `assertExternalDirectoryEffect`.
First attempt did exactly that and **broke** the existing
`does not ask for external_directory permission when reading configured
references` test: `reference.ensure`/`reference.contains` match a target
against `item.path` (an internal reference-cache directory) via lexical
string comparison; canonicalizing only the *caller's* argument (in read.ts)
while `item.path` stays uncanonicalized introduced a real macOS `/var` →
`/private/var` mismatch and broke first-clone materialization (regression,
not a fix).

Root-caused it one level deeper instead: `containsReferencePath` (inside
`reference.ts`) now canonicalizes **both** sides itself via `containsReal`,
so the check is correct regardless of what form the caller's path is in —
consistent with the "fix once in the primitive" approach used everywhere
else in this issue. Reverted the read.ts call-order change; kept a comment
explaining why order no longer matters. Verified: the previously-broken test
passes again, and the full opencode + core test suites are otherwise
unaffected (see Checks).

The plan's row 5 ("HTTP file endpoints choke point" —
`opencode/src/util/filesystem.ts:171`) turned out to be stale against current
code: `File.read`/`File.list` (the actual `/file/content`, `/file` HTTP
handlers) already route through `containsPath` (the same primitive fixed in
`instance-context.ts`), not `util/filesystem.ts`'s standalone `contains`. No
separate edit was needed there — added regression + escape tests directly
against `File.read`/`File.list` in `path-traversal.test.ts` to prove it.

## Checks

- Fork build: `cd apps/opencode_fork/packages/opencode && bun run build --single` — **PASS** (0 exit, smoke test passed).
- Fork tests, touched files: `bun test test/tool/external-directory.test.ts test/tool/read.test.ts test/tool/shell.test.ts test/file/path-traversal.test.ts` — **90 pass, 0 fail**.
- Fork tests, full `core` package: `bun test` — **337 pass, 1 fail** (pre-existing, confirmed via `git stash`: `cross-spawn-spawner.test.ts` macOS `/tmp` vs `/private/tmp` cwd-string assertion, unrelated file).
- Fork tests, full `opencode` package: `bun test` — **2668 pass, 8 fail, 12 skip, 1 todo** (all 8 confirmed pre-existing via `git stash` + re-run: 6 `skill.test.ts` global-skills-dir discovery failures, 1 `config.test.ts` jsonc-creation failure, 1 `ModelsDev Service` data-drift failure — none touch containment/symlink code).
- api_server build: `npm run build` (tsc) — **PASS**, clean.
- api_server targeted vitest: `npx vitest run src/__tests__/path_containment.test.ts src/__tests__/opencode_worktrees_routes.test.ts src/__tests__/issue_1060_file_find_proxy.test.ts src/__tests__/issue_1058_isolate_worktree.test.ts` — **35 pass, 0 fail**.
- api_server broader: `npx vitest run src/__tests__/agent_sessions*` — **56 pass, 0 fail**.
- api_server full suite: **347 files / 3118 tests pass, 21 fail** — all 21 confirmed pre-existing via `git stash` + re-run (7 `memory_*` vault-path tests + `engraph_manager.test.ts`, an unrelated PATH-discovery test polluted by a real `/opt/homebrew/bin/engraph` on this dev machine). None touch the files in this diff.
- `detect_changes({scope:"compare"..."all"})` (GitNexus) — risk **LOW**, 12 changed symbols across the 13 tracked files listed above, 0 affected processes, **no** `mcp_server` / registry-section / file-picker touches.
- Live gated test: authored at `apps/api_server/src/__tests__/live_e2e_1133_symlink_escape.test.ts` (`RHYTHM_LIVE_E2E=1`, confirmed it self-skips without the flag — 2 tests skipped, 0 run). **Not run against the live sandbox in this session** — per the task's instructions this is executed later by the verification gate (`tools/dev/sandbox.sh up` was already occupied by a concurrent worktree/agent at the time of this work; reusing/rebuilding it risked interfering with that session, so local `bun test`/`npx vitest run` was used for all fork/api_server verification instead).

## Notes / residual findings (not fixed — out of the approved scope)

- `grep.ts` (`tool/grep.ts:63`) has the same "bypass computed from `reference.contains(requested)` on a not-yet-canonicalized path" shape as the read.ts bug, but since `containsReferencePath` now canonicalizes internally this is already closed at the source — no separate fix needed, and confirmed no regression in `bun test` (grep tests unaffected).
- `apps/opencode_fork/packages/opencode/src/plugin/shared.ts:93` (`Filesystem.contains(root, next)`, plugin entrypoint containment) already calls `Filesystem.resolve` (realpath) on both sides before comparing — not vulnerable to the same class of bug, and out of scope (not an agent-facing filesystem/shell/HTTP surface).
