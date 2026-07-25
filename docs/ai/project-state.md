# Project State

## Current focus

Complete the aggregate Task 18 release gates on draft PR #1165: final live
sandbox/fork coverage, signed simulator and physical-device smoke, EAS/TestFlight
validation, and human manual review.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Verified implementation head: `6aee45226`

## In progress

- Mobile roadmap Tasks 1–16 are integrated through issues #1166–#1174.
- Task 17 has the #1175 security/corrective slices integrated, including
  host-bound pairing, owner/admin authorization, human-approval and taint
  hardening, Activity/delegation isolation, production paired transport, and
  local development-config correction.
- The branch also integrates #1096, #1123, #1132, #1134, #1135, #1137,
  #1157, #1161, #1162, and #1164.
- #1076 is bounded by successor issues #1176, #1177, and #1178.
- The PR remains intentionally draft and its body now reports the current plan
  position, approximately 75 registered Rhythm MCP tools, and remaining gates.

## Risks / known issues

- Compare-to-main impact is expected HIGH/CRITICAL because this branch
  intentionally accumulates the full #1076–#1175 implementation.
- #1135's additive SQLite/Postgres change requires normal migration review.
- Task 18 distribution evidence is incomplete; do not merge before signed
  device/TestFlight and manual smoke gates.
- The implementation ledger is a historical July 24 stop record; this snapshot
  and `docs/ai/runs/` are the current handoff sources.

## Test status

- `ai-workflow checks --level issue` passes.
- `ai-workflow checks --level pr` passes all Flutter, API, MCP, fork, and mobile
  static/contract/fake-server/web-E2E checks and builds.
- MCP local validation passes 22/22 files and 99/99 tests, typecheck, build, and
  an exact Node 22.19.0 Undici load.
- Rebuilt-fork isolated sandbox health, OpenCode health, capabilities, and auth
  readiness probes pass on dedicated ports; the sandbox was removed afterward.
- GitHub Mobile CI passes at `39f18a22a`; MCP Server CI passes at implementation
  head `6aee45226`.
- Existing focused and live behavioral evidence remains recorded in
  `docs/ai/runs/`; final aggregate signed-device/distribution evidence is still
  outstanding.

## Next step

Run the remaining Task 18 cumulative live tests and signed-device release
workflow, record exact evidence, complete `docs/testing/manual-smoke.md`, and
leave PR #1165 for human review rather than merging it.
