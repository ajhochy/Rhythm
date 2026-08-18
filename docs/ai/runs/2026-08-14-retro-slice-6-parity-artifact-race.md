---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [electron-m1-slice-6]
status: retrospective
smoke_result: not-run
verification_claimed: false
divergence: false
tags: [retro, adherence]
---

# Slice 6 parity artifact verification race

## Per-criterion comparison

| Criterion | Contract | Observed | Category |
|---|---|---|---|
| slice-6-c1–c5, c7–c8 | pass | Generator/validator logic and published structure remained valid. | P process |
| slice-6-c6 | pass | The generator is deterministic for a fixed tree, but the tree changed between generation and byte comparison: 11,859 → 11,861 declarations. | P process |

## Workflow

- **Expected chain:** generate twice from a stable inventory → validate → compare published artifacts.
- **Observed chain:** the same checks ran, but a concurrent Electron slice wrote a run note with two scanner-matching declarations between the green generation and final comparison.
- **Skipped skills:** none evidenced. This is a missing concurrency boundary, not a validation or determinism defect.

## Issue

- **P process / Slice 6 inventory boundary:** `docs/ai/runs/` is mutable execution evidence but is included in the `docs` scan; parallel run-note writes can therefore invalidate generated artifacts without a product or matrix change. Detected from the two added declarations and count change.

## Smallest durable correction

Exclude `docs/ai/runs/` from the parity inventory. Run notes are operational evidence, not declared product/documentation checks, and their concurrent mutation makes an artifact byte comparison inherently racy. Keep scanning durable docs; regenerate once after this boundary change.

No skill edit is warranted: adding a global parallel-write rule is broader than the local scanner-boundary correction.

## Outcome

**overall_score: partial.** The failure correctly caught an artifact/source mismatch; it did not reveal nondeterminism or invalid validation logic.
