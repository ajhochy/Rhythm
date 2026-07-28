---
date: 2026-07-28
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1175, 1197, 1198, 1199, 1200]
status: ready-for-independent-review
tags: [run, Rhythm, mobile, ios, integration]
index: "[[Rhythm]]"
---

# PR #1165 current-main integration and source freeze

## Files changed

- Merged `origin/main` through
  `80d1552acb94eb1c4d6ba7471c5dfb55fd438e1d` into the mobile release
  branch and resolved 11 conflict files.
- Preserved current-main managed creative runtimes, Memory OKF lifecycle and
  provenance, and provider-stream inactivity recovery.
- Preserved the mobile branch's outbound-action approval gates and OpenCode
  stream scheduling/backpressure.
- Added `memory.lifecycle` to the shared API/MCP security action registries,
  bound `rhythm_verify_memory` to exact approval payloads, and registered the
  83rd MCP tool in the security graph and capability contract.
- Updated the real MCP memory live gate to assert that missing trusted
  session/turn metadata fails closed without changing lifecycle or trust state.
- Updated release evidence and the project snapshot without recording
  credentials, private hostnames, device identifiers, or signing material.

## Checks run

- Focused API creative installer: 8/8 PASS plus TypeScript.
- Focused MCP Memory/security/registration: 16/16 PASS plus TypeScript.
- Focused API security action parity: 7/7 PASS plus TypeScript.
- Focused OpenCode LLM scheduler/inactivity: 17/17 PASS plus TypeScript.
- Pairing service: 10/10 PASS.
- Mobile contract and pairing compatibility: PASS.
- `ai-workflow checks --level issue`: PASS after integration.
- `ai-workflow checks --level pr`: PASS before freeze and again on exact
  source SHA `6dd2516f96b357d99854b8fbcb0ef6ad1206ae07`.
- Isolated exact-port health probes: API, OpenCode, capabilities, and dedicated
  mobile gateway PASS.
- Live pairing compatibility: 1/1 PASS.
- Live pairing and mobile tool authorization: 1/1 PASS.
- Live MEM-OKF API/MCP/vault behavior: 5/5 PASS.
- Live paired-gateway project isolation: 1/1 PASS.
- Focused maximum-Dynamic-Type contract: 2/2 PASS.
- Changed-line credential-shaped scan: PASS.
- GitHub PR workflows on the frozen source: Desktop CI, Server CI, MCP Server
  CI, OpenCode Fork CI, and Mobile CI PASS.

## Notes

- Frozen source:
  `6dd2516f96b357d99854b8fbcb0ef6ad1206ae07`. Later commits are restricted
  to evidence, run logs, project state, acceptance status, roadmap status, and
  smoke postmortems.
- Conflict policy: current-main creative installer and Memory OKF behavior
  remained authoritative; mobile security and stream-control behavior was
  composed around it rather than replacing it.
- GitNexus deviation: MCP impact/detect tools were unavailable and the local
  wrapper did not return. No current-head GitNexus pass is claimed. Conflict
  inspection, diff hygiene, focused tests, two full local matrices, live
  behavior, and five green GitHub workflows form the recorded fallback.
- Repair loop: cached dependencies and an expanded approval fixture fixed the
  initial focused API gate; shared action parity and tool-count/security graph
  updates fixed the first full gate; two stale live-test assumptions about
  source identity and initial trust tier were corrected before the final 5/5
  pass. No follow-up issue was required.
- The retrospective miner ran over 87 postmortems. Its generated absolute-path
  rewrite was not retained because it replaced portable repository context
  with temporary worktree paths; no new canonical skill change was warranted.
- #1197 independent review is next. #1198 signed development build, #1199
  physical-device matrix, and #1200 production/TestFlight remain deliberately
  pending human gates. PR #1165 remains draft and was not merged.
