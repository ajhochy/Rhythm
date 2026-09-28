---
date: 2026-09-27
repo: Rhythm
branch: codex/org-reviewer-context-budget
pr: null
issues: [org-reviewer-context-budget]
status: verified
tags: [run, Rhythm]
---

# Org Reviewer context budget

## Files

- `apps/api_server/src/services/org_reviewer_service.ts`
- `apps/api_server/src/services/__tests__/org_reviewer_service.test.ts`
- `apps/api_server/src/__tests__/org_reviewer_live.test.ts`
- `docs/ai/contracts/org-reviewer-context-budget.json`
- `docs/ai/runs/2026-09-27-org-reviewer-context-budget.md`

## Acceptance contract

The pre-implementation command was:

```sh
cd apps/api_server && npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism
```

Result: **FAIL**, 7 failed / 29 passed. Each new pressure regression failed at
`OrgReviewerService.context` with HTTP 409
`Verified reviewer context exceeds the bounded review window`.

The implementation preserves `MAX_CONTEXT_BYTES = 44_000`. It builds the exact
target/fixed response first, fails closed if that alone does not fit, then admits
whole optional items only while the actual pretty-serialized response remains
below the cap. Returned target state and message evidence references are not
partially cut. Collection and live-catalog omission counts are explicit.

## Checks

### GitNexus pre-edit impact

- `OrgReviewerService.context`, canonical indexed repo
  `/Users/ajhochhalter/Documents/Rhythm`: **LOW**, 0 resolved dependents,
  0 affected processes/modules.
- `OrgReviewerService.liveCapabilityCatalog`: **LOW**, 2 direct callers
  (`context`, `resolveCurrentTarget`), 1 indirect caller (`submit`), and the
  existing Submit processes. No HIGH/CRITICAL approval gate was triggered.

### Focused unit contract

```sh
cd apps/api_server && npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism
```

Result: **PASS**, 1 file / 36 tests. This includes simulated pressure from 88 DB
skill summaries, 438 MCP tool IDs, 261 live skills, and a session with four
4,000-character messages; default, `sessionLimit:1`, target-specific,
determinism, truncation metadata, and final `<44,000` pretty-byte assertions pass.

### API TypeScript build

```sh
cd apps/api_server && npm run build
```

Result: **PASS**, `tsc -p tsconfig.json` and postbuild exited 0. No packaged
`dist` file is tracked in the worktree diff.

### Sandbox rebuild/restart and health

```sh
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-org-reviewer-context-sandbox \
RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/packages/opencode \
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-org-reviewer-context-fixture-2 \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-org-reviewer-context-fixture-2/rhythm.db \
RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-org-reviewer-context-fixture-2/opencode.json \
tools/dev/sandbox.sh restart
```

Result: **PASS**, sandbox ready at API `:4098`, engine `:4097`; the restart
preserved the sandbox DB and vault. `tools/dev/sandbox.sh status` with the same
variables reported API PID 99562, engine PID 99577, and gateway PID 99562.
The manager-owned sandbox was preserved for the required final teardown.

### Real signed API/MCP behavior

The first invocation omitted `RHYTHM_SANDBOX_DIR`; harness setup correctly
failed before the assertion because `POST /agent-sessions` rejected an empty
`cwd` with HTTP 400. The corrected exact command was:

```sh
cd apps/api_server && \
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-org-reviewer-context-sandbox \
DB_PATH=/private/tmp/rhythm-org-reviewer-context-sandbox/rhythm.db \
npx vitest run src/__tests__/org_reviewer_live.test.ts --no-file-parallelism \
  -t 'org-reviewer-context-budget-c9'
```

Result: **PASS**, 1 passed / 10 skipped. Through the actual fork engine and
signed Rhythm MCP call, both `{}` and `{windowDays:7, sessionLimit:1}` returned
overview context, catalog hashes, collection metadata, a pretty API value below
44,000 bytes, and fenced MCP output below 50 KiB.

Fixture limitation: this is the approved sanitized sandbox catalog, not a clone
of the current installation's approximately 261 skills / 438 tools / 88 DB
skills. Those exact pressure levels are covered by the focused real-service unit
regression; the live test proves transport, signing, API wiring, and limits with
the sandbox's actual backend and engine catalogs.

### Scope and change impact

```sh
git status --short && git diff --check && git diff --stat
```

Result: **PASS**, only the five owned source/test/contract/run-note files are
changed; whitespace check exited 0. GitNexus `detect_changes(scope=all)` reported
medium aggregate risk, 3 changed indexed source files, and the existing Submit
processes affected through `resolveCurrentTarget`; focused submission/security
regressions are included in the 36-test passing service suite.

## Notes / remaining risk

- Target `currentState` remains complete and hash-stable. An oversized complete
  target (including the existing oversized skill fixture) still fails closed.
- Optional collections are deterministic whole-item prefixes. Lower-priority
  entries may be omitted under pressure, with total/included/omitted/truncated
  metadata rather than misleading partial entries.
- No auth, reviewer identity, proposal submission, profile seed, packaged output,
  dependency, migration, or production configuration was changed.

The completed run was published to AJ's Dev Dashboard with session
`codex/org-reviewer-context-budget`; the publisher advanced revision 5815 to
5816 and reported `OK`.

## Handoff

`READY_FOR_VERIFICATION` — review the bounded collection response shape and run
the contract command from `docs/ai/contracts/org-reviewer-context-budget.json`.

## Repair attempt 1 — static-first allocation

Verification correctly found that the first implementation admitted sessions
before static collections and catalogs. The original c3 assertion covered only
the final byte size and metadata, so it could not falsify that priority error.

### Strengthened red contract

```sh
cd apps/api_server && \
npx vitest run src/services/__tests__/org_reviewer_service.test.ts \
  --no-file-parallelism -t 'org-reviewer-context-budget-c3'
```

Result before the repair: **FAIL**, 1 failed / 35 skipped. Adding one
full-pressure transcript changed static catalog inclusion from 150 to 49 MCP
tools and from 13 to 0 live skills. The strengthened test now compares the same
static fixture before and after transcript pressure and requires all static
included prefixes to remain unchanged.

GitNexus re-analysis of `OrgReviewerService.context` before editing remained
**LOW**: 0 resolved dependents and 0 affected processes/modules.

### Minimal source repair

No allocator abstraction changed. The existing fit calls now run in this order:
profiles, schedules, proposal queue, DB skills, MCP tool IDs, live skills, then
sessions. Sessions still consume remaining capacity when a whole session fits.

The first full-suite repair run exposed an over-strict old c6 assertion: it
required exactly one returned session even though c6 explicitly permits session
omission. Result was 35 passed / 1 failed. The assertion now accepts either a
trustworthy returned session with message omission metadata or explicit top-level
`included: 0, omitted: 1`; it does not force zero sessions.

### Repair checks

```sh
cd apps/api_server && \
npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism
```

Result: **PASS**, 1 file / 36 tests.

```sh
cd apps/api_server && npm run build
```

Result: **PASS**, TypeScript build and postbuild exited 0.

```sh
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-org-reviewer-context-sandbox \
RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/packages/opencode \
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-org-reviewer-context-fixture-2 \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-org-reviewer-context-fixture-2/rhythm.db \
RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-org-reviewer-context-fixture-2/opencode.json \
tools/dev/sandbox.sh restart
```

Result: **PASS**, API `:4098` and engine `:4097` ready without replacing the
sandbox DB or vault. Status reported API/gateway PID 12960 and engine PID 12975.
The manager-owned sandbox was preserved for the required final teardown.

```sh
cd apps/api_server && \
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-org-reviewer-context-sandbox \
DB_PATH=/private/tmp/rhythm-org-reviewer-context-sandbox/rhythm.db \
npx vitest run src/__tests__/org_reviewer_live.test.ts --no-file-parallelism \
  -t 'org-reviewer-context-budget-c9'
```

Result: **PASS**, 1 passed / 10 skipped through the real signed MCP boundary.

```sh
git diff --check && git status --short
```

Result: **PASS**, whitespace check exited 0. The implementation remains confined
to the five owned files listed above. Status also shows the untracked
`docs/ai/runs/2026-09-27-retro-org-reviewer-context-budget-ordering.md` created by
workflow-retrospective; this repair did not read, edit, or remove that file.
GitNexus change detection remains medium aggregate risk through the existing
target/submission processes, with no expanded source-file scope.
The repair run was published to AJ's Dev Dashboard; the publisher advanced
revision 5826 to 5827 and reported `OK`.

## Final verification

Verification gate: **PASS after repair attempt 1**. Focused service tests passed
36/36; API build/typecheck passed; the full clean API suite passed 6,175 tests
with 250 skipped; advisory checks passed 15/15; signed live sandbox c9 passed
1/10 with 10 skipped; API/engine health and `git diff --check` passed.

The live fixture remains smaller than the unit pressure set (88 DB skills, 438
MCP tools, and 261 live skills). API lint remains a placeholder, and GitNexus
reports medium aggregate risk in existing target/submission flows despite
focused/full suites passing.

Handoff: AJ review and authorization for commit, push, and draft PR if desired.

## Final sandbox teardown

The required isolated teardown completed successfully. Sanitized diagnostics
were preserved at `/private/tmp/rhythm-org-reviewer-context-sandbox.evidence.qSCWEQ`
and the sandbox was removed.
