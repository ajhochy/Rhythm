# Current Plan — resolve open issues #1076–#1175

**Date:** 2026-07-25
**Branch:** `codex/issues-1076-1175-2026-07-24`
**Status:** active parallel implementation and integration

## Goal

Resolve every currently open issue from #1076 through #1175, verify each
behavior against an isolated API/engine or signed development client where
needed, consolidate the reviewed work, and produce merge-ready draft PRs
without touching the installed app or production data.

## Constraints

- One isolated worktree per implementation slice; never modify the primary
  dirty checkout.
- GitNexus impact before symbol edits and compare/detect analysis before every
  commit.
- Backend behavior requires an env-gated live test against the rebuilt fork
  and API.
- Flutter changes require format, analyze, tests, and signed-client smoke when
  the behavior is visual or native.
- Push draft PRs only; do not merge.

## Integrated verified slices

- #1096, #1123, #1132, #1134, #1135, #1157, #1161, #1162, #1164.
- Mobile foundation and #1166–#1168.
- #1137 is integrated but review-failed pending corrective follow-up.

## Remaining phases

1. Repair and independently re-review #1137.
2. Integrate final reviewed #1169; run #1170 and #1171 in parallel where their
   dependency bases permit, then complete #1172–#1174.
3. Run #1175's combined API, fork, MCP, Flutter, mobile, contract, live,
   accessibility, security, secret-scan, signing, and device gates.
4. Re-fetch the open-issue range, close every acceptance gap, run GitNexus
   compare-main analysis, push, and open draft PRs.

## Verification authority

`docs/ai/contracts/`, `docs/ai/runs/`, and `.agent-stack/postmortems/` carry
per-issue acceptance and smoke evidence. This file stays a lean coordinator
plan rather than duplicating issue-specific designs.
