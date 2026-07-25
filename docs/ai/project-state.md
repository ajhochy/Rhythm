# Project State

## Current focus

Resolve and independently verify every open issue in #1076–#1175 on the
coordinator branch, then run the combined merge gate and open a draft PR.

## Active branch / PR

- Branch: `codex/issues-1076-1175-2026-07-24`
- PR: none; isolated issue worktrees are integrated only after verification.

## In progress

- Integrated and verified: #1096, #1123, #1132, #1134, #1135, #1157,
  #1161, #1162, #1164, #1166, #1167, #1168, and #1169.
- The mobile app/gateway foundation is consolidated; #1168 enforces
  authenticated, project-scoped, allowlisted device access, while #1169
  exposes the generated operation allowlist through the hardened proxy.
- #1137's regression-first corrective slice is integrated and live-verified; the fork now
  consumes browser binaries after selection, Flutter binary `@` mentions use
  the API's canonical contained path, native reads sample before loading, and
  exact skill/MCP reader matches outrank generic catalog coincidences.

## Risks / known issues

- #1137's initial evidence remains explicitly invalidated; the expanded built
  live gate now passes and independent immutable re-review is pending.
- Mobile compare-to-main impact is expected HIGH because the previously
  unfinished app/gateway foundation is now consolidated into Rhythm.
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
- #1137 is review-failed pending repair despite earlier green gates.
- #1170 passes 10 focused contracts, API build, the clean 3,248-test API
  remainder, and a rebuilt-fork live smoke for session SSE plus PTY closure.
  The full suite's only failure is the unchanged #723 Vitest VM dynamic-import
  callback defect, reproduced on the reviewed base.
- Aggregate coordinator validation is pending after all slices land.

## Next step

Run #1137's independent immutable re-review while #1170 and #1171 continue in
parallel, then complete the remaining mobile slices, combined gates, and draft
PRs.
