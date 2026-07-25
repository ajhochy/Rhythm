---
date: 2026-07-25
repo: Rhythm
branch: codex/fix-desktop-release-sqlite-smoke
pr: 1184
issues: []
status: passed
tags: [run, rhythm, release]
index: "[[Rhythm]]"
---

## Files changed

- `.github/workflows/desktop_release.yml`: PR #1184 resolves the bundled
  `better-sqlite3` path with `path.resolve()` before `require()`.
- `apps/api_server/src/__tests__/skill_schema_parity.test.ts`: follow-up static
  guard requires the release workflow to preserve filesystem resolution.
- `docs/ai/project-state.md`: replaced stale pre-release state with the
  published `v0.18.51` status.

## Checks run

- Targeted parity test: expected pre-fix failure, then 9/9 passed.
- `ai-workflow checks --level issue`: passed.
- `ai-workflow checks --level pr`: passed after one non-reproducible first-run
  test failure was triaged.
- `npm run build` in `apps/api_server`: passed.
- `actionlint .github/workflows/desktop_release.yml`: passed.
- Direct Node falsification: the legacy relative module specifier exited 1;
  the resolved path loaded `better-sqlite3` and executed an in-memory query.
- GitNexus `detect_changes`: 3 files, 0 affected processes, LOW risk.
- Desktop Release run
  [30178638700](https://github.com/ajhochy/Rhythm/actions/runs/30178638700):
  passed every build, packaged smoke, signing/notarization, upload, and publish
  step in 13m57s.

## Notes

- Failed run
  [30177744675](https://github.com/ajhochy/Rhythm/actions/runs/30177744675)
  booted the bundled server successfully, but its DB probe passed a relative
  filesystem path to Node `require()`. Node treated it as a package name,
  repeatedly threw `MODULE_NOT_FOUND`, and surfaced a misleading optimizer-seed
  timeout.
- PR #1184 merged concurrently while the verification run was in progress; the
  branch was reconciled with `origin/main` to avoid a duplicate fix PR.
- The first full local PR check returned a 404 in
  `issue_1048_engine_session_delete.test.ts`. Failure triage found the test
  unchanged from base; it passed alone 4/4, across five repeats 20/20, and on
  the next full PR run. No scoped change or follow-up issue was warranted.
- [Rhythm v0.18.51](https://github.com/ajhochy/Rhythm/releases/tag/v0.18.51)
  is published with signed/notarized DMG and ZIP assets.
