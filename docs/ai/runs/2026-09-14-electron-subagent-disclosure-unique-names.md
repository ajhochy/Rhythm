---
date: 2026-09-14
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [E20]
status: ready-for-verification
tags: [run, Rhythm]
---

# E20 disclosure accessible-name collision repair

## Files

- `apps/web/src/components/SessionRail.tsx` — adds an eight-character stable session-ID discriminator only when included parent sessions with loaded children have equal names.
- `apps/web/tests/electron-e20-session-ordering.spec.ts` — exact equal-name/equal-count coverage across sorting, refresh reconciliation, and independent collapse; verifies a unique parent remains ID-free.
- `docs/ai/contracts/electron-e20-session-ordering.json` — records the added passing criterion.
- This run note. Styles and store were unchanged by this repair.

## Acceptance contract

- Pre-implementation: `npm exec -- playwright test --config tests/electron-e20-playwright.config.ts --grep subagent-disclosure-collision` — **FAIL**, expected `Same name (parent-a): 1 subagent`, received `Same name: 1 subagent`.
- Post-implementation same command — **PASS**, 1 passed.
- Regression caught: removing collision detection or the stable ID suffix makes the two equal-name/equal-count disclosure controls expose the same accessible name; adding IDs unconditionally breaks the exact unique-name assertion.

## Impact

- GitNexus upstream impact for `SessionRail` (`apps/web/src/components/SessionRail.tsx`): **LOW**, one direct caller (`AgentsWorkspace`), three total upstream symbols, zero affected processes, two modules.
- `detect_changes(scope=all, worktree=...)`: **LOW**, 86 indexed symbols / 35 files in the already-dirty shared worktree, zero affected processes. This repair remained confined to the owned source, E20 test/contract, and this note.

## Checks

- `npm exec -- playwright test --config tests/electron-e20-playwright.config.ts` — **PASS**, 26 passed (13.6s). Exact accessible names serve as the accessibility evidence; the existing harness also captured desktop/narrow disclosure screenshots under the configured temporary E20 output paths.
- `npm exec -- playwright test --config tests/electron-e21-playwright.config.ts` — **PASS**, 6 passed (13.6s).
- `npm exec -- playwright test tests/sessions.spec.ts tests/gateway/sessions-gateway.spec.ts --workers=1` — **PASS**, 7 passed (5.4s).
- `npm run typecheck && npm run build && npm run test:dist-smoke` — **PASS**; Vite built 1,679 modules and dist smoke verified the index plus two relative assets. The existing large-chunk warning remained non-fatal.
- Isolated lifecycle with fixture root `/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a`, sandbox `/private/tmp/rhythm-subagent-disclosure-unique`, API/engine/gateway `7498/7497/7499`: `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status`, trap-driven `down` — **PASS**. API PID 48012, engine PID 48030; sandbox removed and diagnostics preserved at `/private/tmp/rhythm-subagent-disclosure-unique.evidence.I3sN9u`.
- `git diff --check -- apps/web/src/components/SessionRail.tsx apps/web/tests/electron-e20-session-ordering.spec.ts docs/ai/contracts/electron-e20-session-ordering.json` — **PASS**.
- Node JSON parse plus `E20-disclosure-collision.status === "pass"` — **PASS**.

## Handoff

READY_FOR_VERIFICATION. Final UI review and verification only; no redesign, style/store change, package/full-suite run, commit, push, PR, merge, or live/candidate port contact occurred.
