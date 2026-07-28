# Project State

## Current focus

Integrate current `main` into draft PR #1165, preserve the mobile security and
pairing behavior across conflicts, and establish a new exact source SHA for the
independent iOS release review.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Main integrated through: `80d1552ac`
- Frozen review source: pending the verified merge commit

## In progress

- Resolve the integration conflicts between the mobile branch and current
  `main`.
- Rerun issue-level, PR-level, focused integration, contract, and isolated live
  pairing checks before freezing the candidate.
- #1197 remains the independent exact-head review gate.
- #1198 remains the signed EAS development build gate.
- #1199 remains the authenticated physical-device and isolated-Mac matrix.
- #1200 remains the production EAS/TestFlight provenance and install smoke.

## Risks / known issues

- `main` added provider-stream inactivity recovery, managed creative-runtime
  installation, and memory lifecycle/provenance after the mobile branch
  diverged. Conflict resolution must retain those changes together with the
  branch's scheduler and outbound-action security gates.
- Credentials, signing assets, build artifacts, pairing/device tokens, private
  hostnames, and iPhone UDIDs must never be committed or printed.
- Local Xcode/simulator evidence does not replace #1198 or #1200 EAS/TestFlight
  provenance.
- The deployed production API still uses the older mobile OAuth request
  contract; the release sequence must not treat production sign-in as green
  until a matching reviewed backend is deployed.
- Do not merge before the human release gates are complete.

## Test status

- Pre-integration desktop live-local and iOS simulator smoke passed.
- Pre-integration issue and PR checks passed.
- Post-integration verification is pending.

## Next step

Complete the merge resolution, run the full verification gate, commit the
source merge, and record that immutable SHA for #1197.

## Recent coding-agent runs

### 2026-07-28 — PR #1165 current-main integration

- Files modified: resolved conflicts in the API creative installer and live
  regression, Memory MCP tools/tests, fork LLM scheduler/inactivity
  implementation/tests, API lockfile, sandbox testing documentation, failure
  patterns, and this project snapshot.
- Checks run: API creative-installer tests 8/8 and typecheck passed; MCP Memory
  tests 9/9 and typecheck passed; fork LLM tests 17/17 and typecheck passed;
  mobile contract/pairing compatibility passed 1/1; pairing service tests
  passed 10/10; `git diff --check` passed.
- Decisions made: retained current `main`'s managed creative-runtime
  implementation, memory provenance/lifecycle fields, and provider inactivity
  middleware while preserving the mobile branch's outbound-action approval
  gates, model stream scheduler/backpressure behavior, and forged-approval
  live regression.
- Deviations from spec: GitNexus MCP impact/detect tools were unavailable; the
  local wrapper did not return from an impact request, so Git diff/caller
  inspection and the required test gates are the available integration
  evidence.
- Concerns: the cumulative mobile branch remains a high-risk, broad
  compare-to-main review surface; the independent #1197 review must use the
  exact post-verification merge SHA.
