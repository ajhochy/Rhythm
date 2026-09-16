---
date: 2026-09-14
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [E20]
status: ready-for-verification
tags: [run, Rhythm]
---

# E20 disclosure unique-prefix final repair

## Files

- `apps/web/src/components/SessionRail.tsx` — same-name parent disclosures now use the shortest stable ID prefix that distinguishes the rendered collision group, with an eight-character minimum.
- `apps/web/tests/electron-e20-session-ordering.spec.ts` — adds shared-first-eight equal-name/equal-count coverage through sorting, refresh reconciliation, and independent collapse; exact visible labels remain count-only.
- `docs/ai/contracts/electron-e20-session-ordering.json` — records the repaired acceptance criterion and evidence.
- This run note. No store, styles, or other product files were edited in this repair.

## Acceptance contract

- Red: `cd apps/web && npm exec -- playwright test --config tests/electron-e20-playwright.config.ts --grep subagent-disclosure-collision` — **FAIL** as intended: expected `Same name (parent-shared-a): 1 subagent`, received the colliding fixed-prefix name `Same name (parent-s): 1 subagent`.
- Green: the same command — **PASS**, 1 passed (2.2s).
- Regression caught: distinct same-name parent IDs sharing their first eight characters must expand only their accessible-name discriminator through the first distinguishing character; fixed eight-character labels fail the exact accessible-name assertions.

## Impact

- GitNexus upstream `SessionRail` impact: **LOW**, one direct caller (`AgentsWorkspace`), three total upstream symbols, zero affected processes, two modules.
- Final `detect_changes(scope=all, worktree=/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement)`: **LOW**, 86 indexed changed symbols across 35 already-dirty indexed files, zero affected processes. The repair itself stayed within the approved source, E20 test/contract, and this note.

## Checks

- `cd apps/web && npm exec -- playwright test --config tests/electron-e20-playwright.config.ts` — **PASS**, 26 passed (13.7s).
- `cd apps/web && npm exec -- playwright test --config tests/electron-e21-playwright.config.ts` — **PASS**, 6 passed (14.1s).
- `cd apps/web && npm exec -- playwright test tests/sessions.spec.ts tests/gateway/sessions-gateway.spec.ts --workers=1` — **PASS**, 7 passed (6.4s).
- `cd apps/web && npm run typecheck && npm run build && npm run test:dist-smoke` — **PASS**; Vite built 1,679 modules and dist smoke verified the index plus two relative assets. The existing large-chunk warning remained non-fatal.
- Approved isolated lifecycle used fixture root `/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a`, sandbox `/private/tmp/rhythm-subagent-disclosure-prefix`, and API/engine/gateway `7598/7597/7599`: `tools/dev/sandbox.sh up`, `status`, and trap-driven `down` — **PASS**. Status reported API PID `57587`, engine PID `57607`, gateway PID `57587`; teardown removed the sandbox and retained sanitized diagnostics at `/private/tmp/rhythm-subagent-disclosure-prefix.evidence.h7sgIs`.
- Scoped `git diff --check` — **PASS**. Node parsed `docs/ai/contracts/electron-e20-session-ordering.json` and confirmed `E20-disclosure-collision.status === "pass"`.

## Notes

- Parent IDs are assumed unique as approved. The discriminator uses no order, index, count, or mutable state. Unique parent names have no ID noise; visible disclosure count/running text is unchanged.
- Live `4001/4096`, candidate processes, old `709x`, and retained `589x` were not contacted or signaled. No full suite, package, commit, push, PR, merge, or peer dispatch occurred.

## Handoff

READY_FOR_VERIFICATION.
