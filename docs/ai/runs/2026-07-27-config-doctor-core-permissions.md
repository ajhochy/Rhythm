---
date: 2026-07-27
repo: Rhythm
branch: codex/config-doctor-core-permissions
pr: pending
issues: []
status: verified
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Config-doctor core-permission scope patches

## Files changed

- Extended the shared diagnosis contract and refine-scope applier for validated
  `corePermissionsJson` `set`/`unset` patches with nested-map deep merge.
- Added core-permission context and layer guidance to workflow diagnosis.
- Collapsed simultaneous `Error: Aborted` cohorts into one external signal.
- Added acceptance, prose-disambiguation, and guarded live HTTP tests.
- Documented the foreground sandbox command and captured recon evidence in
  `docs/testing/results/recon-config-doctor-core-permissions.md`.

## Checks run

- GitNexus upstream impact checks: LOW for every final edited implementation
  symbol. A discarded repository-class expansion rated CRITICAL.
- `ai-workflow checks --level issue`: PASS.
- `ai-workflow checks --level pr`: PASS.
- Focused Vitest bundle: PASS, 7 files / 60 tests.
- Acceptance contract: PASS, 6/6.
- `npm run build`: PASS.
- Fork `bun run build --single`: PASS; binary smoke test passed.
- Foreground isolated sandbox live test: PASS, 1/1.
- `/health`, `/opencode/health`, `/agents/capabilities`, and `/opencode/auth/`:
  HTTP 200; no unavailable state.
- Sandbox teardown: PASS; ports 4097 and 4098 listener-free.
- `git diff --check`: PASS.

## Notes

- Repair-loop summary: Flutter checks initially lacked permission to update the
  external SDK cache; the fork build initially lacked direct access to
  `models.dev`; real-server tests initially lacked localhost socket access; and
  a background sandbox was reaped by the automation host. Failure triage found
  environment-only causes. Verification was rerun with scoped permissions and
  a foreground sandbox. One unrelated #858 test failed once in the full suite,
  passed in isolation, and the full suite passed on rerun. No source workaround
  or follow-up issue was required.
- The live test's deep-equality assertion would fail if applying a core patch
  dropped the existing `bash["git push*"]` rule or `webfetch` permission.
- Playwright, screenshots, packaged-runtime parity, and manual-only coverage are
  N/A because this change is a deterministic backend HTTP surface.

## Next

Commit, push, open a draft PR, and monitor required GitHub checks. Do not merge.
