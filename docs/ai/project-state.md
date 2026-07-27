# Project State

## Current focus

Open a draft PR for the live-verified config-doctor fix: core-permission scope
patches, diagnosis visibility, and simultaneous-abort attribution.

## Active branch / PR

- Branch: `codex/config-doctor-core-permissions`.
- PR: pending (draft only; do not merge).
- The separate MEM-OKF PR #1205 remains outside this branch and may require a
  project-state reconciliation if both branches land.

## In progress

- Commit the verified diff, push the feature branch, open a draft PR, and
  monitor required GitHub checks.
- Keep the generated Flutter `.dart_tool` symlink and fork `bun.lock` build
  drift out of the commit.

## Risks / known issues

- GitNexus rated the edited implementation symbols LOW risk. A proposed
  repository-class expansion was rejected after its class-level impact rated
  CRITICAL; the final diff uses the existing snapshot plumbing.
- The finite core-permission name list must be updated when the embedded engine
  adds a new permission key.
- Abort coalescing intentionally recognizes exact `Error: Aborted` cohorts
  among the 20 most recent error sessions for a profile.

## Test status

- `ai-workflow checks --level issue`: PASS (Flutter analyze/format, API tsc).
- `ai-workflow checks --level pr`: PASS (issue checks plus full API Vitest).
- Focused config-doctor/legacy suite: PASS, 60/60.
- Acceptance contract: PASS, 6/6.
- API build and fork single-binary build/smoke: PASS.
- Foreground sandbox live approval/readback: PASS, 1/1.
- Sandbox probes: PASS, HTTP 200 for health, engine health, capabilities, and
  auth; ports 4097/4098 clear after teardown.

## Next step

Commit the verified diff, push, open a draft PR, and watch required CI without
merging.
