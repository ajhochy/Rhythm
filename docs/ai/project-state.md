# Project State

## Current focus

Complete the four human iOS release gates split from umbrella #1175. The
cumulative mobile roadmap is complete through every automatable Task 17/18
check.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Immutable tested source: `8701432480f585fe90119cbaee66382d062da879`
- PR head policy: evidence-only descendants after the tested source

## In progress

- #1197: independent review of the exact PR #1165 release candidate.
- #1198: signed EAS development build for a physical iPhone.
- #1199: complete signed-build matrix on an isolated Mac sandbox and physical
  iPhone.
- #1200: production EAS build, exact-artifact TestFlight submission, and
  bounded TestFlight install smoke.
- Dependency order is #1197 → #1198 → #1199 → #1200. #1175 tracks the
  umbrella gate and links the checklist.

## Risks / known issues

- Any product, native configuration, dependency-lock, generated-runtime, or
  release-script change invalidates downstream release evidence and restarts
  the chain from the affected source SHA.
- The physical-device run must use an isolated branch-built API/engine and
  private Tailscale Serve gateway. It must not fall back to production staff
  data or expose the OpenCode engine directly.
- Credentials, signing assets, build artifacts, pairing/device tokens, private
  hostnames, and iPhone UDIDs must never be committed or printed.
- #1186 tracks a non-blocking automation improvement for a foreground sandbox
  lifecycle; the corrected final source smoke passed without a product change.
- #1135's additive SQLite/Postgres change requires normal migration review.
- GitNexus compare-to-main is CRITICAL (987 files, 7,076 symbols, 21 flows)
  because this cumulative branch intentionally includes the roadmap, vendored
  engine, and linked issues. Review found zero unexpected flows.
- Do not merge before the human gates above are complete.

## Test status

- Source-freeze GitHub CI is green: API/server, MCP type/build, fork,
  Flutter/macOS desktop, and both Mobile CI runs.
- `ai-workflow checks --level issue` and `ai-workflow checks --level pr`
  passed the cumulative local gates.
- Rebuilt #1175 security/creative matrix passed 9/9 live assertions.
- Final exact-port source smoke passed #1166 (1/1), #1168 (1/1), and #1170
  (2/2) on API `4098` / engine `4097`; installed listeners `4001/4096`
  retained PIDs `964/1016`.
- Current-head #1123 async delegation passed 2/2 and #1171
  desktop-to-mobile access passed 1/1 before the later CI/evidence-only fixes,
  which did not touch those paths.
- Native iOS 18.3 simulator smokes passed at maximum and normal Dynamic Type
  for Agents/Activity and Webhooks; the focused corrective regression passed
  2/2 on the source freeze.
- Durable logs and hashes are under `docs/ai/evidence/`; exact commands and the
  repair loop are in
  `docs/ai/runs/2026-07-25-mobile-roadmap-finalization.md`.

## Next step

Complete #1197 against source `8701432480f585fe90119cbaee66382d062da879`,
then proceed in order through #1198, #1199, and #1200. Keep PR #1165 draft and
unmerged until the full chain and final human approval are complete.
