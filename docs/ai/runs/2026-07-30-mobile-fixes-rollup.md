---
date: 2026-07-30
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1277, 1278, 1279, 1280, 1281, 1282, 1283]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Mobile Agents fixes rollup

## Files changed

- Integrated eight clean local commits on top of
  `origin/codex/fix-session-isolation-runtime-performance`.
- Production changes remain in the original bounded surfaces: mobile Agents
  navigation/composer/provider, API ownership/memory/proxy/webhook/startup
  services, parity normalization, and their contracts/live tests.
- Preserved each issue's acceptance contract and dated run log.

## Checks run

- `ai-workflow checks --level issue` passed.
- `ai-workflow checks --level pr` passed every configured stage on the
  combined branch.
- Full serial API command passed 3,788 tests with 122 skipped.
- Full fork session command passed 383 tests with 4 skipped and 1 todo.
- A freshly built isolated API/fork sandbox returned HTTP 200 from all four
  documented health probes.
- Five env-gated live files passed against that same attested sandbox:
  paired mobile memory/tool authorization, startup auth-watch ordering,
  projectless desktop-session ownership, profile-scoped mobile creation, and
  already-connected desktop→mobile transcript delivery.
- `tools/dev/parity-gate.sh` passed 14/14 feeds in a second disposable sandbox.
- After GitHub Mobile CI exposed a live profile-refresh race in the shared
  session configuration sheet, the new component regression passed and all
  seven native Jest cases passed. The complete `npm run verify:foundation`
  command then passed all 69 Playwright cases in CI order.
- The complete `ai-workflow checks --level pr` matrix passed again after the
  shared-sheet repair.
- Draft PR #1284 opened against
  `codex/fix-session-isolation-runtime-performance`; its Server CI and
  PR-triggered Mobile CI checks passed.
- `.proof/i1235/ui/agents-tab.png` is 30,624 bytes and visibly shows the
  compact Agents header with a top-right overflow trigger.
- GitNexus exact-base comparison reported LOW risk and zero affected
  execution processes.

## Notes

- The first PR-matrix run exposed an API shared-state assertion and a fork
  cancellation timeout. Failure triage found no stable rollup regression:
  the exact API file passed 12/12, the cancellation test passed in 1.4 seconds,
  the full API command passed 3,788/3,788, the full fork suite passed, and the
  complete matrix passed on rerun. No assertion or timeout was weakened.
- The first Mobile CI run and its rerun both created the issue #1172 lifecycle
  chat as `Untitled chat` under runner load. An initial Playwright-only
  synchronization repair passed locally but failed again in GitHub, proving
  the issue was in production state handling. The shared session configuration
  sheet was reinitializing whenever live profiles or preferences refreshed
  while it remained open, clearing the typed title. Initialization now runs
  only on the sheet's closed-to-open transition, and a component regression
  proves refreshed props preserve and submit the title.
- The first live invocation was rejected by the isolation guards because the
  test process lacked `DB_PATH` and the sandbox had not been started with a
  throwaway human-approval capability. The sandbox was restarted with one-run
  credentials generated locally without printing them; the corrected live
  run passed 5/5. Credentials and both sandbox directories were removed.
- Issue #1280 remains open for physical-iPhone validation. No release,
  TestFlight action, merge, or production mutation occurred.
