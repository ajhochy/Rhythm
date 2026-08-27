---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1480, 1481, 1483, 1484]
status: ready-for-verification
tags: [run, Rhythm]
---

# PR #1489 final triage repair

## Acceptance

WAIVED: test/docs-only PR-gate repair with no product behavior change; verification is the reproduced RED, focused contracts, clean-env serial API suite, TypeScript/build, JSON, reference, and diff gates.

## Files

- `apps/api_server/src/contract/config_doctor_core_permissions_contract.test.ts` — supplies the evidence quote now required by the production diagnosis parser.
- `apps/api_server/src/services/opencode_client_service.test.ts` — passes an explicit empty host value so inherited `RHYTHM_LOCAL_RENDERER_ORIGINS` cannot affect the empty-input case.
- `docs/ai/contracts/{issue-1483,pr-1489-adversarial-review,pr-1489-cleanup-repair}.json` — removes the deleted harness reference, points maintained criteria at executable tests, and leaves the current live rerun criteria `UNVERIFIED`.

## Checks

- RED before repair: `npx vitest run src/contract/config_doctor_core_permissions_contract.test.ts --no-file-parallelism` — 1 failed / 5 passed; `result.created` was empty because the injected diagnosis lacked an attached evidence quote.
- Focused: `npx vitest run src/contract/config_doctor_core_permissions_contract.test.ts src/services/opencode_client_service.test.ts src/contract/issue_1483.test.ts src/contract/pr_1489_adversarial_review.test.ts src/contract/pr_1489_harness_race_repair.test.ts --no-file-parallelism` — 5 files / 90 tests passed.
- Clean-env full API serial, first attempt: `env -i PATH="$PATH" HOME="$HOME" SHELL="$SHELL" TERM="$TERM" node node_modules/vitest/vitest.mjs run --no-file-parallelism` — command timeout after 900 seconds with no failing-test summary.
- Clean-env full API serial, allowed retry with a 30-minute command budget: same command — 642 files / 6002 tests passed; 118 files / 208 tests skipped; duration 851.48 seconds.
- `node_modules/.bin/tsc --noEmit && npm run build` — passed, including postbuild.
- Contract reference scan: zero `task_s4_diagnosis_provider_harness.test.ts` references under `docs/ai/contracts`.
- Contract JSON parse and `git diff --check` — passed.
- GitNexus `detect_changes(scope=all)` was attempted against this linked worktree; the connected v41 reader could not open the v42 index, so no change-flow result was available and no HIGH/CRITICAL result was returned.
- Package dependencies were reused from the worktree; no install and no lockfile change.

## Latest live invocation and corrected rerun

The latest full live invocation was not green: Vitest was launched with `HOME="$RHYTHM_SANDBOX_HOME"`. That made Vitest compute HOME-relative defaults inside the sandbox HOME and failed isolation setup before the three live cases ran. It is not evidence for c16-c20, cleanup c2/c3/c5, or issue-1483-c5; those criteria remain `UNVERIFIED`.

The sandbox process keeps its own sandbox HOME. The verifier must leave Vitest on the agent/operator HOME and pass the sandbox paths explicitly. Before invoking Vitest, validate both separations:

```bash
test "$HOME" != "$RHYTHM_SANDBOX_HOME"
test "$RHYTHM_MANAGED_SKILLS_DIR" != "$HOME/.config/opencode/skills"

RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_SANDBOX_HOME="$RHYTHM_SANDBOX_HOME" \
RHYTHM_MANAGED_SKILLS_DIR="$RHYTHM_MANAGED_SKILLS_DIR" \
npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism
```

Do not export or prefix `HOME="$RHYTHM_SANDBOX_HOME"` for the Vitest process. The remaining live URL, engine URL, DB, sandbox directory, and fixture-origin variables must continue to point at the already-running isolated verifier sandbox.

## Notes

- Executable invalid-provenance rejection/non-mutation assertions are at `live_e2e_1480_1481_1483_1484.test.ts:472-503`; the valid install control and scoped restoration are at lines 517-532; isolation and strict final cleanup are at lines 263-291 and 329-389.
- No product code, sandbox lifecycle action, push, or lockfile change was made.
- GitNexus impact was attempted for both edited test files; the connected v41 reader cannot open the v42 index, so risk is `UNKNOWN` with no HIGH/CRITICAL result.
