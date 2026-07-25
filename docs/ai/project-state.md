# Project State

## Current focus

Consolidate the corrected #1137, #1170, and #1171 slices into the mobile
activity/chat branch, then finish the production mobile gateway wiring required
by #1172 and #1173.

## Active branch / PR

- Branch: `codex/mobile-1172-agents-activity`
- PR: none; this is the isolated mobile integration worktree.

## In progress

- Integrated and verified: #1096, #1123, #1132, #1134, #1135, #1157,
  #1161, #1162, #1164, #1166, #1167, #1168, #1169, and #1170.
- The mobile app/gateway foundation is consolidated; #1168 enforces
  authenticated, project-scoped, allowlisted device access, while #1169
  exposes the generated operation allowlist through the hardened proxy.
- #1137's final corrective slice is independently reviewed and live-verified;
  the fork consumes browser binaries after selection, mobile prompt file parts
  are canonicalized and contained before engine forwarding, full bytes are
  classified even for declared text MIME, and valid DOCX extraction requires
  structured tool proof.
- #1171's corrective pairing slice is awaiting its final commit and independent
  review. #1172's activity/chat foundation and #1173's tool screens are being
  consolidated in parallel; #1174 parity implementation remains in progress.

## Risks / known issues

- Compare-to-main impact is expected HIGH/CRITICAL because this worktree
  intentionally inherits the cumulative #1076–#1175 implementation.
- Production project-catalog, authenticated project-header injection, activity
  transport, and tool transport wiring remain before the mobile client is
  shippable.
- Fork-wide typecheck has one unrelated `GlobalBusEmitter.emit` base failure;
  focused fork/core suites pass.
- #1135's additive SQLite/Postgres change requires normal migration review.
- #1123 adds one Rhythm MCP tool; update the PR tool count.

## Test status

- All listed integrated issues have focused/full automated checks and required
  live sandbox or signed-client evidence in their run logs.
- #1166 pairing, #1167 account lifecycle/mobile gates, and #1168 live project
  isolation all pass with no auth/token residue.
- #1169 passed independent security review, the serialized 3,207-test API
  suite, and a real gateway/engine smoke covering pairing, session lifecycle,
  contained file access, and denied operations.
- #1137's final immutable review passes at `0c8ab294b`, including the guarded
  six-test live endpoint suite.
- #1170 passes 10 focused contracts, API build, the clean 3,248-test API
  remainder, and a rebuilt-fork live smoke for session SSE plus PTY closure.
  The full suite's only failure is the unchanged #723 Vitest VM dynamic-import
  callback defect, reproduced on the reviewed base.
- #1172's pre-integration acceptance, browser, API, and live checks pass.
- `ai-workflow checks --level issue` passes.
- `ai-workflow checks --level pr` passes every Flutter, API, MCP, fork, and
  mobile static/contract/fake-server/web-E2E sub-gate.
- Focused correction gates pass: browser 16/16, mobile proxy 11/11, issue-723
  2/2, mobile Playwright 15/15.
- Fresh real-engine sandbox gates pass: mobile containment 1/1 and the
  structured-proof #1137 file 6/6. Dedicated ports 5497/5498 are free and the
  sandbox was removed.
- Aggregate coordinator validation is pending after all slices land.

## Next step

Finish the #1137 cherry-pick, independently approve and integrate #1171, then
wire #1172/#1173 to the strict paired-device production surface before the
aggregate behavioral gate.

## Recent coding-agent runs

- 2026-07-25 — #1137 review correction: replaced serialized Office-proof
  matching with completed structured tool-part and transcript-order assertions;
  red mention-only regression reproduced, focused build passed, and dedicated
  live sandbox passed 4/4 before clean teardown.

### 2026-07-25 — #1137 shared-port live guard

- Files modified: `live_e2e_1137_any_file_reader_discovery.test.ts` for robust
  API/engine endpoint parsing and pre-request rejection;
  `docs/ai/contracts/issue-1137.json` for criteria c12-c13; the #1137 run log
  for exact red/green, listener, sandbox, and teardown evidence.
- Checks run: focused red produced one failing and three passing non-live tests;
  focused green passed 4/4 with two live tests skipped; API build passed;
  dedicated 5497/5498 live gate passed 6/6 in 33.22s and the sandbox was
  removed.
- Decisions made: kept the stricter endpoint guard local to #1137 so unrelated
  live suites retain their existing #1001 isolation behavior; fail closed on
  malformed, non-HTTP, non-loopback, implicit-port, and shared-port URLs.
- Deviations from spec: none.
- Concerns: cumulative compare-to-main risk remains inherited from the
  #1076-#1175 integration branch; this correction changes no production symbol.
