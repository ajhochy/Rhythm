---
date: 2026-09-29
repo: rhythm
branch: fix/org-reviewer-session-context
pr: 1593
issues: [org-reviewer-session-context]
status: draft-pr-open
tags: [run, rhythm]
---

# Org Reviewer session context fix

## Files

- `apps/api_server/src/services/org_reviewer_service.ts`: sessions are fitted
  first, each session gets a share of the transcript allowance with prefix
  clipping, `fitCollection` skips items that don't fit instead of stopping, and
  omission stats now carry `omittedByByteBudget` and `omittedWithoutMessages`.
- `apps/api_server/src/services/__tests__/org_reviewer_service.test.ts`: new
  regression `org-reviewer-session-context`. c3 is rewritten for the
  sessions-first priority, c4 covers the new stats fields, and c6 accepts a
  clipped (included) pressure session.
- `apps/api_server/src/__tests__/org_reviewer_live.test.ts`,
  `org_reviewer_harness.ts`: new signed live check. `transcript()` accepts an
  existing session. afterAll cleanup is raised from 60 s to 180 s.
- `docs/ai/decisions/2026-09-29-org-reviewer-sessions-first.md`,
  `docs/ai/contracts/org-reviewer-context-budget.json` (c3 superseded).

## Checks

### Root cause: reproduced before the fix

Unit regression on unmodified service code:

```sh
cd apps/api_server && npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism -t 'org-reviewer-session-context'
```

**FAIL**, 1 failed / 36 skipped: `expected 0 to be greater than or equal to 2`
(sessions included = 0).

Live sandbox, unmodified service, signed MCP read `{windowDays:7, sessionLimit:100}`:

```
apiBytes 43984, fencedBytes 41094
sessions  total 15 included 0 omitted 15
profiles  total 15 included 9   schedules total 7 included 4
mcpToolIncluded 1/103, skillIncluded 0/16
withheldByContentSafety: null
```

The byte budget, not the content scanner, caused the omission. Static
collections filled the response to 43,984 bytes before any session was
considered. The unit reproduction adds the second factor: the newest session
alone took the full 14,000-byte transcript allowance.

### Focused unit (after fix)

```sh
cd apps/api_server && npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism
```

**PASS**, 37/37.

```sh
cd apps/api_server && npx vitest run src/__tests__/org_reviewer_routes.test.ts src/__tests__/org_reviewer_harness_isolation.test.ts src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism
```

**PASS**, 3 files / 45 tests.

### Build

`cd apps/api_server && npm run build`: **PASS** (tsc + postbuild).

### Full API suite

`cd apps/api_server && npx vitest run`: 6,775 passed, 2 failed, 286 skipped
(719/869 files passed). Both failures are environmental and unrelated. The
worktree's symlinked `node_modules` has better-sqlite3 **12.8.0** under Node
24.21.0, while `package.json` requires `^13.0.3`:
- `native_runtime_guard.test.ts`: "Unsafe native SQLite runtime: Node 24.21.0
  with better-sqlite3 12.8.0".
- `human_approval_signature.test.ts`: expected 401, got 503 from the same
  runtime guard.

### Live sandbox (after fix)

Fixture: `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-orgrev-session-ctx-fixture`,
then copied to `/private/tmp/rhythm-orgrev-session-ctx-fixture2` with
`RHYTHM_AGENT_URL=http://127.0.0.1:4098` added to the MCP environment. The
harness requires it, and the generator does not emit it.

```sh
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-orgrev-session-ctx-sandbox \
RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/packages/opencode \
RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 \
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-orgrev-session-ctx-fixture2 \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-orgrev-session-ctx-fixture2/rhythm.db \
RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-orgrev-session-ctx-fixture2/opencode.json \
RHYTHM_OPTIMIZER_MODE=shadow tools/dev/sandbox.sh up   # then `restart` after npm run build

cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-orgrev-session-ctx-sandbox \
DB_PATH=/private/tmp/rhythm-orgrev-session-ctx-sandbox/rhythm.db \
npx vitest run src/__tests__/org_reviewer_live.test.ts --no-file-parallelism --reporter=verbose \
  -t 'org-reviewer-session-context|org-reviewer-context-budget-c9'
```

**PASS**, 2 passed / 10 skipped:

```
apiBytes 43999, fencedBytes 37404
sessions  total 15 included 15 omitted 0 omittedByByteBudget 0 omittedWithoutMessages 0
large session messageStats: total 8 included 2 omittedByByteBudget 6 (clipped, still included)
profiles 6/15, schedules 0/7, queue 0/1 (all omittedByByteBudget)
mcpToolIncluded 14/103, skillIncluded 1/16, withheldByContentSafety: null
```

A full live-file run passed 10/12. The two failures are fixture gaps that
predate this change: c13 needs `/private/tmp/org-reviewer-sandbox-token`
(ENOENT), and c16 needs legacy schedules this synthetic fixture does not have.
Two retries timed out in beforeAll (120 s) while sandbox background skill
extraction was busy; the next attempt passed. Sandbox torn down with
`tools/dev/sandbox.sh down`. Evidence was preserved at
`/private/tmp/rhythm-orgrev-session-ctx-sandbox.evidence.XqoLZJ`.

### GitNexus

`impact` and `detect_changes` failed: MCP "Connection closed". Blast radius was
checked by hand instead. `fitCollection` and `collectionStats` are private to
this module, and `OrgReviewerService.context` has one caller,
`OrgReviewerController.context`. `submit`, `verifyEvidence` and
`resolveCurrentTarget` are unchanged.

## Notes

- Unchanged: `MAX_CONTEXT_BYTES` 44,000, `MAX_TRANSCRIPT_BYTES` 14,000, owner
  and pipeline filtering, evidence verification, targeted-state hashing, and
  fail-closed behavior for an oversized target.
- Tradeoff: under pressure, profiles, schedules, the queue and catalog entries
  are omitted before transcripts. This is reported per collection.
- Every item that doesn't fit still costs one pretty stringify of the response
  (up to about 1,000 × 44 KB in the worst case). The unit suite showed no
  measurable slowdown.
