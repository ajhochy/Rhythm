---
date: 2026-07-25
repo: Rhythm
branch: codex/1096-release-gate
pr: 1165
issues: [1096, 1175]
status: in-progress
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #1096 notarized release-gate correction

## Files changed

- Added `tests/contract/issue-1096-release.mjs` and moved criterion c11 from a
  false-green manual Debug-app result to a pending executable integration
  contract.
- Added `tools/release/smoke_signed_clean_user.sh`. It mounts the notarized DMG,
  copies and verifies the app, launches the real packaged executable with a
  fresh HOME and temporary memory vault, proves Engraph is disabled/absent,
  writes a unique memory, recalls it through SQLite FTS, and proves no
  `.engraph` directory was created.
- Updated `.github/workflows/desktop_release.yml` so release candidates fail
  closed on missing Apple credentials, verify the app and DMG with codesign,
  Gatekeeper, and stapler, run the clean-user smoke, and publish only when the
  explicit `publish_release` input is true.
- Updated `tools/release/sign_and_notarize_macos.sh` so a missing signing or
  notarization credential is an error rather than a successful unsigned skip.

## Checks run

- RED: `node --test tests/contract/issue-1096-release.mjs` failed because the
  clean-user signed-app smoke did not exist.
- GREEN: the same contract passed after implementation.
- `bash -n tools/release/smoke_signed_clean_user.sh tools/release/sign_and_notarize_macos.sh`
  passed.
- Ruby YAML parsing of `.github/workflows/desktop_release.yml` passed.
- The signing script with no Apple environment exited 1 and named the missing
  credential without printing any value.
- GitNexus `detect_changes --scope all` reported no indexed symbol changes,
  expected because this slice changes workflow, shell, JSON, and a new static
  contract rather than indexed application symbols. `git diff` remains the
  authoritative file-scope cross-check.

## Notes

- The previous c11 evidence was not release evidence: it exercised an
  Apple-Development-signed Debug app rather than the notarized packaged
  artifact. The contract remains pending until the final aggregate head runs
  the signed candidate workflow and this script passes there.
- Failure triage found the initial EAS config crash was a broken dependency
  link in an isolated worktree. A locked `npm ci` restored the local Expo config
  loader; no product code change was needed.
- Expo token authentication succeeded without logging or persisting the token.
  The production Cloud URL is configured in EAS, and the existing App Store
  Connect API key is stored and assigned to the production submit profile.
- The supported non-interactive Apple signing bootstrap reached Apple but
  failed with an authoritative 403: the team must accept the latest Developer
  Program agreement before a production bundle ID, distribution certificate,
  or App Store profile can be created. Retrying cannot change that account
  state, so no duplicate credentials were created.
- The real Google iOS OAuth client and matching reverse redirect are still
  unavailable. The production bundle must remain fail-closed; a web client or
  placeholder is not an acceptable substitute.
- No follow-up issue was filed because these remaining gates belong directly to
  the open #1175 production-release acceptance criteria.
