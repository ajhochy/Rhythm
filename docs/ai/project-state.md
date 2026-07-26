# Project State

## Current focus

Hand draft PR #1165 to its human-only release gates. The cumulative mobile
roadmap is complete through every automatable Task 17/18 check.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Immutable tested source: `8701432480f585fe90119cbaee66382d062da879`
- PR head policy: evidence-only descendants after the tested source

## Completed

- Mobile roadmap Tasks 1–16 are implemented and integrated through issues
  #1166–#1174.
- Task 17's source, security, live-sandbox, full-suite, secret-scan, GitNexus,
  push/CI, and durable evidence gates are complete.
- Task 18's rebuilt API/fork/gateway matrices and native simulator smokes are
  complete through the Apple/physical-device boundary.
- The branch also integrates closure-ready work for #1123, #1132, #1134,
  #1135, #1137, #1157, #1161, #1162, #1164, #1181, and #1182.
- Draft PR #1165 contains the closure metadata for those issues.

## Human gates / risks

- #1175 remains open for the immutable independent whole-branch review, signed
  physical-iPhone matrix, production archive/TestFlight provenance, and human
  approval.
- #1096 remains open for its signed/notarized clean-user checklist.
- #1076 remains bounded by successor issues #1176, #1177, and #1178.
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

Human completes #1175's immutable review, signed physical-iPhone checklist,
production/TestFlight steps, and #1096's clean-user release checklist, then
reviews `docs/testing/manual-smoke.md` and decides whether to approve/merge the
draft.
