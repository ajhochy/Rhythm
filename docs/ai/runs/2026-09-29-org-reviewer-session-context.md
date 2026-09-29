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

---

# Follow-up (same PR): split into index + paged session/catalog reads

AJ's decision: split the data across separate tool calls instead of squashing
it into one. This supersedes the sessions-first clipping above. The design is in
`docs/ai/decisions/2026-09-29-org-reviewer-sessions-first.md`, which has been
rewritten.

## Files

- `apps/api_server/src/services/org_reviewer_service.ts`:
  - The overview now emits a compact session index. Transcript clipping is
    removed (`MAX_TRANSCRIPT_BYTES`, the per-session share, excerpt clipping).
  - New `session()`: one session per call, full text, pages of ≤ 40,000 bytes.
    The cursor is `[sessionId, messageId, charOffset]` in base64url.
  - New `catalog()`: whole-entry pages over profiles, schedules, queue, skills,
    mcpTools and liveSkills.
  - Shared `reviewableSessions()` scope and `overviewCollections()` builder.
  - `verifyEvidence` checks the full message text over the same 200-message
    view.
  - Byte budgets are measured on compact JSON, which is what MCP emits.
- `controllers/org_reviewer_controller.ts`, `routes/org_proposals_routes.ts`:
  `POST /agent-org-proposals/reviewer/session` and `/reviewer/catalog`, both
  signed-trustedCall only.
- `services/org_reviewer_seed.ts`, `.mcp-roles/org-reviewer.mcp.json`, and
  `config_seeds/skills/review-agent-org-health/SKILL.md`:
  - Four review tools.
  - An exact-v1 profile, schedule or skill is upgraded in place. Any other drift
    still fails closed.
  - The skill and seed prompt now say: read the index, read error/tool-error
    sessions fully, page omitted configuration, then propose.
- `apps/mcp_server/src/tools/orgReviewer.ts`: new `rhythm_read_org_review_session`
  and `rhythm_read_org_review_catalog`. Each message piece and catalog entry is
  content-scanned, and the fenced page must stay under 50 KiB.
- Tests: service (regression, scope, catalog, c3/c6 rewritten), seed (v1 upgrade
  plus an edited-skill refusal), routes, MCP tool/role-graph/registration counts,
  live suite, and the v1 skill fixture
  `apps/api_server/src/__tests__/fixtures/review-agent-org-health.v1.SKILL.md`.
- `docs/ai/contracts/org-reviewer-context-budget.json`: c3 and c6 superseded.

## Checks

- `cd apps/api_server && npx vitest run src/services/__tests__/org_reviewer_service.test.ts --no-file-parallelism`:
  **PASS 40/40**. The regression (67 sessions plus heavy config) measured:
  - Overview 43,910 B, of which the session index is 21,314 B. Sessions 67/67,
    `omittedByByteBudget` 0.
  - The oversized 150 KB+ message reassembled exactly from 5 pages
    (39,736 / 39,736 / 39,735 / 39,737 / 35,364 B).
  - A late-tail quote verified through `submit`.
- Mutation checks:
  - Restoring the 4,000-char verifier slice fails 2 tests.
  - Replacing the session scope with `findById` fails 4 tests.
- Related suites (routes, harness isolation, seed binding/reconciliation,
  issue_738, issue_830, projection, auto-promotion, skill parity): **PASS**,
  10 files / 175 tests.
- `cd apps/mcp_server && npm run typecheck && npm run build && npx vitest run`:
  **PASS**, 33 files / 193 tests (2 skipped).
- `cd apps/api_server && npm run build`: **PASS**.
- `cd apps/api_server && npx vitest run`: 6,783 passed, 1 failed, 286 skipped
  (720/869 files). The one failure is the known environmental
  `native_runtime_guard.test.ts` (symlinked better-sqlite3 12.8.0 on
  Node 24.21.0).
- Live sandbox, with the same recipe as above and a fresh fixture at
  `/private/tmp/rhythm-orgrev-paged-fixture2`:
  - `org_reviewer_live.test.ts` passed 10/12. The 2 failures are the known
    fixture gaps: c13 has no owner token, and c16 has no legacy schedules.
  - With a synthetic sandbox-only owner (`org-reviewer-sandbox@example.invalid`
    plus a session token in the sandbox DB), c13 also **PASS**ed. That covers
    the impostor getting 403 and another owner's session getting 404 from the
    session tool.
  - Index: 43,998 B from the API, 44,425 B fenced, 16/16 sessions,
    `omittedByByteBudget` 0.
  - Oversized session (3 × 30,000-char messages): **3 pages**, fenced
    40,183 / 40,185 / 13,102 B. It reassembled exactly, and the late-tail quote
    submitted.
  - Catalog paging was needed. Next to the index only 6/105 MCP tool IDs,
    1/16 live skills, 10/16 profiles and 1/8 schedules fit. Catalog pages
    returned every entry (fenced bytes): profiles 37,096 + 25,397,
    schedules 7,045, mcpTools 4,331, liveSkills 929, queue 543, skills 544.
  - v1 upgrade: I set the sandbox profile, schedule and skill to exact v1, then
    ran `sandbox.sh restart`. The profile and schedule came back with four
    tools, the skill was rewritten, and the reviewer stayed enabled.
  - Torn down with `sandbox.sh down`. The token file was removed, and no
    listeners remain on 4097/4098.
- GitNexus `impact` returned "Connection closed" again. Manual caller check:
  `OrgReviewerService` is used only by `OrgReviewerController`, and
  `seedOrgReviewerTask` only by `org_optimizer_seed.ts`.
- SQL: none added. Reviewer transcripts use the existing SQLite-only
  `AgentSessionMessagesRepository`, and the reviewer seed already fails closed
  on Postgres. The schedule upgrade goes through `updateAsync`, which covers
  both `dbClient` branches.
