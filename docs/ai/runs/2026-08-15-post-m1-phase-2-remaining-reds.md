---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-2]
status: partial
tags: [run, rhythm]
---

# Post-M1 Phase 2 remaining reds

## Files

- `apps/web/tests/post-m1-phase-2-profiles.redspec.ts`
  - Waits for the intentionally delayed live create request before asserting the exact request count/body.
- `apps/api_server/src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts`
  - Makes c2c read the real engine session independently and converts fork session storage into the canonical engine model reference.

No product source, `apps/electron/**`, `tools/**`, `apps/web/SHA256SUMS`, or
`apps/web/PROVENANCE.md` was changed. Neither changed test file is listed in
`apps/web/SHA256SUMS`.

## Red 1 — post-m1-p2-c1d

**Evidence supported: test setup (asynchronous synchronization), not a product defect.**

The proposed `selected.cwd` null-dereference does not occur. The store guarantees a selected-session
sentinel at `apps/web/src/store.tsx:126`; the empty-list fallback is created at `:50-56` with
`cwd: ''` and `branch: 'main'`. The live creator then intentionally awaits the 2.2-second engine
stability promise at `apps/web/src/store.tsx:155-157,250-257` before sending `POST /agent-sessions`.
The red spec clicked the button and immediately inspected its request array, before that delay elapsed.
The correction at `apps/web/tests/post-m1-phase-2-profiles.redspec.ts:192` waits until exactly one
request has been observed and retains the existing exact-count, `profileId`, and forbidden-identity
assertions.

Other `selected` users checked in `SessionRail`: initial `cwd`/`branch` state
(`apps/web/src/components/SessionRail.tsx:47,50`), advanced-form reset (`:70-71`), branch change
guard (`:100`), instant-create `cwd` (`:161`), and branch options (`:178`). All receive the same
non-null sentinel and require no product change.

GitNexus impact for `SessionRail` was LOW: one direct caller (`AgentsWorkspace`), followed by
`App` and `main`; no indexed execution process was affected.

Before (orchestrator execution):

```text
Expected length: 1
Received length: 0
Received array:  []
```

After in this unit (Chromium execution prohibited; collection only):

```text
> rhythm-desktop-agents@1.0.0 typecheck
> tsc -b

Listing tests:
  post-m1-phase-2-profiles.redspec.ts:153:1 › post-m1-p2-c1d: selected profileId stays distinct from local and SDK session ids
Total: 7 tests in 2 files
```

The orchestrator must execute c1d. No assertion was weakened.

## Red 2 — post-m1-p2-c2c

**Evidence supported: wrong predicate / cross-test state dependency, not a propagation defect.**

The failing c2c predicate read `state.engineModel`, an in-memory value populated only by the preceding
c2b test. That field is not the engine boundary and can be `undefined` when c2c is evaluated without
c2b's state mutation. Fork storage proves `GET /session/:id` stores its model as
`{ id, providerID, variant? }` at `apps/opencode_fork/packages/opencode/src/session/session.sql.ts:56-60`
and maps it unchanged at `apps/opencode_fork/packages/opencode/src/session/session.ts:72-88`.
At execution time the prompt builds the canonical `{ providerID, modelID }` reference at
`apps/opencode_fork/packages/opencode/src/session/prompt.ts:1315-1326` and maps `modelID` into storage
`id` at `:1338-1350`.

The helper at
`apps/api_server/src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts:144-152` normalizes
the engine response to `{ providerID, modelID }`. c2c now polls the real engine session itself at
`:270-281` and compares that canonical pair directly with the persisted API route. c2a and c2b
assertions were left unchanged. No shared production funnel in `agent_profile_scope.ts` or
`opencode_client_service.ts` was changed because the evidence did not support propagation failure.

Before (orchestrator execution):

```text
AssertionError: expected undefined to deeply equal { providerID: 'openai', modelID: 'gpt-5.6-terra' }
```

After compile:

```text
> rhythm-api-server@0.1.0 build
> tsc -p tsconfig.json

> rhythm-api-server@0.1.0 postbuild
```

After exact live command (assertions not reached):

```text
sandbox: recorded sandbox engine PID 17934 did not release :4097
post-m1-p2 cleanup rows=0 sessions=0 worktrees=0 branches=0

FAIL  src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts > post-m1 Phase 2 persisted profile restart behavior
Error: Command failed: /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/tools/dev/sandbox.sh restart
sandbox: recorded sandbox engine PID 17934 did not release :4097

Test Files  1 failed (1)
Tests  4 skipped (4)
```

Failure-triage classification: environment/process-control blocker. The same failure reproduced on
the untouched baseline and twice after the correction. `ps` also returned `operation not permitted`.
The unit did not edit `tools/**`, manually signal the process, or hand-start a server.

## Checks

- PASS — `cd apps/web && npm run typecheck`
- PASS — `cd apps/web && npx playwright test --config tests/post-m1-phase-2-fixture-playwright.config.ts --list`
- PASS — `cd apps/api_server && npm run build`
- BLOCKED before assertions — `cd apps/api_server && RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts --no-file-parallelism`
- GitNexus `detect-changes`: MEDIUM across 14 pre-existing dirty files / 43 symbols and four task
  flows. The two Phase 2 test files are untracked in this checkout, so the git-diff-backed detector
  did not attribute their hunks; no unexpected indexed production flow was introduced by this unit.

## Restoration and residue

Final HTTP/engine/DB evidence:

```json
{
  "profile": {
    "id": "local-lean",
    "modelProvider": "omlx",
    "modelId": "gpt-oss-20b-MXFP4-Q8"
  },
  "engineAgentModel": "omlx/gpt-oss-20b-MXFP4-Q8",
  "lmstudioAuthPresent": false,
  "rows": [],
  "sessions": []
}
```

Nonce-matching Git worktrees: 0. Nonce-matching local branches: 0.

