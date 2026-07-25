---
date: 2026-07-24
repo: rhythm
branch: codex/1123-async-delegation
pr: null
issues: [1123]
status: verified
tags: [run, rhythm, async-delegation]
---

# Issue #1123 — interactive asynchronous delegation

## Files

- Added `rhythm_delegate_async` to the Rhythm MCP server and
  `POST /agent-delegation/delegate-async` to the API.
- Added interactive-only runtime authorization: manager, session-selectable,
  normal chat, non-system, non-scheduled, roster-bound, non-self, and
  delegation-depth checks.
- Added real parent-linked engine child creation through the existing
  `upsertChildSession` plumbing and subscribed the existing event bridge before
  `promptAsync`.
- Added additive SQLite and Postgres `agent_async_delegations` durable
  completion/outbox state.
- Added a per-parent completion coordinator that defers busy parents,
  transactionally claims/coalesces completed children, deduplicates replayed
  idle events, and wakes the parent through its normal prompt/transcript path.
- Added fail-closed profile projection for non-interactive profiles and
  default-allow projection for eligible interactive managers, with explicit
  `corePermissionsJson` decisions preserved.
- Added contract, stream bridge, MCP, client-body, projection, and env-gated
  live tests. The engine-native `task.ts` and the synchronous delegation
  implementation were not modified.
- Made sandbox API/engine ports env-overridable so this branch could run on
  isolated ports `4198/4197` without touching another run.

## Checks

- GitNexus pre-edit impact:
  - `createSession`: HIGH — optional argument only; create/resume/fork and
    AgentRunner regressions included.
  - `_relayEvent`: HIGH — hook placed after existing assistant/error
    persistence; parent and child roles sequenced without blocking SSE.
  - `runMigrations`: MEDIUM; `runPostgresBootstrap`: LOW;
    `writeAgentProfileFile`: MEDIUM; controller/MCP registration: LOW.
  - The parent acknowledged the HIGH seams before edits.
- Targeted high-seam regression set: 12 files, 200/200 passed.
- Existing synchronous delegation/scheduled guards: 11/11 passed.
- API full suite: 361 files passed, 31 skipped; 3,186 tests passed, 50 skipped.
- API build: `npm run build` passed.
- MCP full suite: 21 files, 97/97 passed.
- MCP typecheck/build: `npm run typecheck && npm run build` passed.
- Branch fork build:
  `cd apps/opencode_fork/packages/opencode && bun run build --single` passed;
  binary smoke version
  `0.0.0-codex/1123-async-delegation-202607250635`.
- Live Recon on sandbox API `:4198` / fork `:4197`:
  - dispatch returned HTTP 202 in 43 ms;
  - parent accepted concurrent user direction first;
  - child returned `CHILD_RECON_DONE`;
  - one normal callback input landed in the parent;
  - the parent emitted `PARENT_WAKE_RECON` through the existing WebSocket.
- Codified live gate:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:4198
  DB_PATH=/tmp/rhythm-1123-sandbox/rhythm.db
  RHYTHM_MANAGED_SKILLS_DIR=/tmp/rhythm-1123-sandbox/home/.config/opencode/skills
  RHYTHM_LIVE_SESSION_CWD=/Users/ajhochhalter/Documents/rhythm-worktrees/run0724-1123
  npx vitest run src/__tests__/issue_1123_live_e2e.test.ts` — 1/1 passed
  in 6.31 seconds.
- `git diff --check` passed.
- GitNexus `detect-changes --scope all`: 13 indexed tracked files, 23
  symbols, zero affected execution flows, LOW risk.
- GitNexus compare-to-main: MEDIUM because this issue branch intentionally
  starts from stacked base `43ef7c389` while local `main` is
  `5a1cea685`; the focused working-tree detection remained LOW.

## Notes

- Red-first contracts initially failed on the missing repository/service/tool.
- The first codified live run reached the completed, exactly-once callback but
  its last assertion compared a local child ID with the SDK child returned by
  `/children`. Failure triage corrected the identity domain; no production
  behavior or acceptance assertion was weakened.
- The live test never polls the child for completion. It waits solely for the
  pushed parent WebSocket turn, then reads the final transcript to assert
  exactly-once persistence.
- Disposable live profiles and sessions were removed after each run. The
  sandbox copied the live SQLite database and disabled scheduled tasks; no
  production server, port, or database was mutated.
- Postmortem:
  `.agent-stack/postmortems/2026-07-24-issue-1123.json`.
- No push, PR, merge, or production migration was performed.
