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

- #1096 — semantic-memory Settings controls and signed/live diagnostics.
- #1123 — interactive asynchronous delegation with durable callback delivery.
- #1132 — complete fork-generated SDK plus compiled-runtime containment fix.
- #1135 — durable audit-locked agent profiles and reviewed re-enable.
- #1137 — arbitrary-file attachment plus actionable reader discovery.

## Remaining phases

1. Integrate the other already-verified issue branches.
2. Complete and independently review #1169–#1174 in dependency order, with
   parallel work only where the dependency graph permits.
3. Run #1175's combined API, fork, MCP, Flutter, mobile, contract, live,
   accessibility, security, secret-scan, signing, and device gates.
4. Re-fetch the open-issue range, close every acceptance gap, run GitNexus
   compare-main analysis, push, and open draft PRs.

## Verification authority

`docs/ai/contracts/`, `docs/ai/runs/`, and `.agent-stack/postmortems/` carry
per-issue acceptance and smoke evidence. This file stays a lean coordinator
plan rather than duplicating issue-specific designs.
