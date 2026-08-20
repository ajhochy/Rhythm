# Rhythm — Project State

## Current focus

- **H1 Flutter fixes (#1421, #1381, #1445, #1074):** verified and ready for a draft PR.
- Preserve the unrelated active workflows: Org Optimizer/self-improvement issue #1448, mobile smart-client PR #1383, and Numbat OpenCode observability PR #1453.

## Active branch / PR

- H1: `codex/mega-h1-flutter-fixes` → draft PR #1459; verification PASS `dff115db-33d1-45b8-b4f1-1c14f7516a35`; manual smoke pending.
- Org Optimizer/self-improvement: `agent-stack/si-causal-runtime-v2-codex`; issue #1448 continues beyond foundation draft PR #1398, which remains unaffected.
- Mobile smart client: `mobile/smart-client-rebuild` → PR #1383. Do not merge before manual smoke.
- Numbat observability: `numbat-opencode-observability` → PR #1453. Do not merge before manual smoke.

## In progress

- H1 automated verification is complete. Contract: `docs/ai/contracts/issue-1421-1381-1445-1074.json`; run note: `docs/ai/runs/2026-08-19-mega-h1-flutter-fixes.md`.
- Contract result: 9 passed and 3 explicit manual `not_tested` criteria.
- Org Optimizer causal-runtime C2-D S6 remains the next live-sandbox slice before C3–C6.
- PR #1453 remains observe-only/local-only Numbat monitoring, separate from Rhythm run-quality telemetry.

## Risks / known issues

- H1 still requires manual smoke for the instant-create failure SnackBar, signed-in packaged-artifact restart persistence, and packaged startup against the real remote relay.
- H1 introduces no destructive migration or schema change.
- Org Optimizer receipt filtering is not yet load-bearing; its existing fail-closed guard remains the promotion protection until C3/C4.
- PR #1383 still requires on-device ready-state smoke; PR #1453 still requires its documented Numbat hook smoke.

## Test status

- H1 Flutter: format and analyze passed; focused 80/80; golden 11/11; full 1226/1226.
- H1 API: typecheck and build passed; relay 10/10; full suite 4480 executed passed, 168 skipped.
- Sandbox live relay evidence passed with sanitized output; protected ports remained intact.
- Org Optimizer remains on its recorded per-slice focused-test/build/typecheck gate; its full API suite is deferred to the campaign ship gate.
- PR #1383 remains green on its recorded mobile/API gates. PR #1453 remains verified with live-sandbox evidence, 13/13 unit tests, and clean TypeScript typecheck.

## Next step

AJ: run the three remaining H1 manual-smoke checks on draft PR #1459. Keep the Org Optimizer, PR #1383, and PR #1453 workflows unchanged.
