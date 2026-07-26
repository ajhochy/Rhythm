# Project State

## Current focus

Hand draft PR #1165 to its human gates. The cumulative mobile roadmap is
complete through every automatable Task 17/18 check; the remaining work is an
immutable whole-branch human security review, signed physical-iPhone smoke, and
production/TestFlight validation.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Source freeze is pending its final commit/push from local head `ee2e8b462`.

## In progress

- Mobile roadmap Tasks 1–16 are implemented and integrated through issues
  #1166–#1174.
- Task 17's source, security, live-sandbox, full-suite, secret-scan, and
  evidence gates are complete. Its immutable independent whole-branch review
  remains human-gated after the automated review service blocked that run.
- Task 18's rebuilt API/fork/gateway matrices and native simulator smokes are
  complete. Apple signing, physical-device coverage, production build, and
  TestFlight remain human-gated.
- The branch also integrates #1096, #1123, #1132, #1134, #1135, #1137,
  #1157, #1161, #1162, #1164, #1181, and #1182.
- #1076 is bounded by successor issues #1176, #1177, and #1178.
- PR issue-closing metadata and immutable commit/CI provenance are the final
  automated handoff actions; the PR remains intentionally draft.

## Risks / known issues

- GitNexus compare-to-main is CRITICAL (968 files, 7,072 symbols, 21 flows)
  because this cumulative branch intentionally includes the full roadmap and
  linked issue work. The exact uncommitted scope is LOW (50 files, 74 symbols,
  zero affected flows).
- #1135's additive SQLite/Postgres change requires normal migration review.
- #1096 remains open for its signed/notarized clean-user checklist.
- #1175 remains open for independent whole-branch review, physical-device
  evidence, production/TestFlight provenance, and human approval.
- Do not merge before the human gates above are complete.
- The implementation ledger is a historical July 24 stop record; this snapshot
  and `docs/ai/runs/` are the current handoff sources.

## Test status

- `ai-workflow checks --level issue` passes.
- `ai-workflow checks --level pr` passes all Flutter, API, MCP, fork, and mobile
  static/contract/fake-server/web-E2E checks and builds.
- Rebuilt #1175 security/creative matrix passes 9/9 live assertions.
- Exact-plan-port sandbox passes #1166 (1/1), #1168 (1/1), #1170 (2/2), and
  #1123 (2/2) while installed listeners 4001/4096 retain their process IDs.
- Current-head #1171 desktop-to-mobile access passes 1/1.
- Native iOS 18.3 simulator smokes pass at maximum and normal Dynamic Type for
  Agents/Activity and Webhooks; #1181/#1182 corrective regression passes 2/2.
- Exact commands and evidence are in
  `docs/ai/runs/2026-07-25-mobile-roadmap-finalization.md`.

## Next step

Commit and push the source freeze, update draft PR #1165 with closure-ready
issue references, wait for CI, then add an evidence-only commit. Hand the draft
to a human for #1175 review and Apple/device/TestFlight gates; do not merge.
