---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: []
status: unverified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

### Integrated fork and SDK artifact checks

- Base: integration HEAD `d677f6fabe168576b79d60462c90e20cbdec9783`. The fork/SDK staged scope contains 12 tracked files: `apps/opencode_fork/bun.lock`, engine package manifest, engine session message/prompt/Read/worktree source and focused tests, `packages/sdk/openapi.json`, both generated SDK type modules, and the vendored API SDK v2 declaration. New A1 XLSX source/tests remain separately untracked in this integration tree; the memory summary/snapshot repair is already in HEAD. No main checkout changes were made for these checks.
- `cd apps/opencode_fork/packages/opencode && bun run typecheck` — exit 0.
- `cd apps/opencode_fork/packages/opencode && bun test test/session/ src/session/ test/tool/task.test.ts` — 439 pass, 5 skip, 1 todo, 0 fail across 31 files; 1,243 assertions; 83.12 s.
- `cd apps/opencode_fork/packages/opencode && bun test test/snapshot/snapshot.test.ts test/snapshot/snapshot-memory.test.ts` — 55 pass, 1 existing Unicode skip, 0 fail across 2 files; 1,424 assertions; 41.47 s.
- `cd apps/opencode_fork/packages/opencode && bun test test/project/worktree.test.ts test/tool/read.test.ts test/tool/attachment-xlsx.test.ts` — 72 pass, 0 fail across 3 files; 183 assertions; 12.01 s.
- `cd apps/opencode_fork/packages/sdk/js && bun run build:rhythm` — exit 0, complete SDK generated and vendored. The first attempt lacked local SDK generator dependencies; existing package `node_modules` symlink maps were copied from the main checkout into the integration worktree, against its private APFS-cloned fork dependency store. No install or lockfile change was performed through a symlink.
- `cd apps/opencode_fork/packages/sdk/js && bun run typecheck` — exit 0. The vendored package manifest's root/v2/client generated exports point to present JS and declaration files.
- Generated diff versus base is four tracked files, 19 insertions and 2 deletions: `WorktreeCreateInput.base` in OpenAPI, v2 types and vendored declaration; Prettier wrapping of the existing `patchOmitted` union in legacy and v2 type modules. Staged generated diff SHA-256: `4c8857f4f4af4eb5bf3f10393bef35ad3767ada846413caff4d725cccd4d6c9d`. No unrelated generated SDK change was observed.
- The CI artifact check equivalent from repo root, `git diff --exit-code -- apps/opencode_fork/packages/sdk/openapi.json apps/opencode_fork/packages/sdk/js/src/v2/gen apps/api_server/vendor/opencode-ai-sdk`, exited 0 after staging only generated SDK files. `git diff --cached --check` and `git diff --check` exited 0.
- `cd apps/electron && npm run typecheck` — exit 0. `RHYTHM_LIVE_E2E` was unset.
- `cd apps/electron && npm test` — exit 0; 455 tests, 451 pass, 4 skip, 0 fail, 37.37 s. The suite exercises its existing local Electron shell/protocol tests and mocked native-boundary contracts. No Hermes build, package payload installation, or API/engine lifecycle was run. Package-shaped `test:package`, installed signed-bundle smoke, and physical human-approval signing remain separate gates.
- Independent read review of the memory fix found the summary entry points coalesce by directory/session before snapshot work, retain only IDs in pending state, and limit active work to two slots (`summary.ts:11-16, 138-165`). Snapshot boundaries and target user metadata are projected in SQLite without loading prior patch arrays (`summary-metadata.ts:6-58`); `diffFull` gates blob reads at 256 KiB, patch output at 128 KiB/file and 1 MiB total, and patch attempts at 256 (`snapshot/index.ts:43-47, 529-808`). The dedicated summary/snapshot tests above cover coalescing, failed/cancelled-worker handoff, and omission behavior. No concrete new defect emerged from this source review; this is not a live memory-growth proof.
- Remaining gate: root owns the running canonical combined sandbox, installed/native attribution, and exact-head CI. These fork/SDK source checks do not claim that live behavior is qualified.
