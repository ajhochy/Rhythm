---
date: 2026-09-14
repo: Rhythm
branch: feature/ios-end-to-end
pr: null
issues: []
status: pass
tags: [run, Rhythm, desktop-release]
---

# Desktop release Node 24 native-addon failure

## Files

- `.github/workflows/desktop_release.yml` — pinned the build-and-bundled Node runtime to 24.18.1.

## Checks

- Reproduced run 34861252571 under exact Node 24.20.0 with `npx vitest run src/__tests__/skill_schema_parity.test.ts`: the third repeated invocation aborted in `Statement::~Statement()` → `RemoveEnvironmentCleanupHook`; all assertions passed when the worker survived.
- Ruled out a Vitest forks-only failure: `--pool=threads --maxWorkers=1` and `--pool=vmThreads --maxWorkers=1` also aborted under Node 24.20.0.
- Confirmed `sqliteColumns()` closes every in-memory database; no source database leak was found.
- Under Node 24.18.1, ran `npx vitest run src/__tests__/skill_schema_parity.test.ts` 20 consecutive times: 20/20 invocations passed, 26/26 assertions each.
- Under Node 24.18.1, ran the release API sequence `npm install && npx vitest run src/__tests__/skill_schema_parity.test.ts && npm run build && npm prune --omit=dev`: passed through production prune. A post-prune in-memory `better-sqlite3` query also passed.

## Notes

- Root cause is Node's 24.19.0+ partial `node::ObjectWrap` cleanup-hook backport, tracked by `nodejs/node#65446`; it aborts NAN-style native addons compiled against affected headers. This is an environment/toolchain defect, not a failed parity assertion or product resource leak.
- The workflow keeps one exact Node runtime for native dependency compilation and app bundling, preserving the ABI guarantee while avoiding the affected Node patch line.
- Beta release workflow `vbeta18.44` failed on Node 24.20.0. The verified Node 24.18.1 workflow fix awaits commit and explicit permission for a new beta release; no replacement release, tag, or deployment occurred.
- No desktop/mobile product code, live app, production system, tag, release, or deployment was touched.
