---
date: 2026-07-25
repo: Rhythm
branch: codex/delegation-activity-1175
pr: null
issues: [1175]
status: scoped-handoff
tags: [run, Rhythm]
---

# Issue #1175 — delegation durability and Activity isolation

## Files

- Hardened synchronous and asynchronous delegation against disabled or
  security-locked caller, target, and parent profiles at the execution
  boundaries.
- Persisted terminal dispatch failures and made parent completion delivery
  crash-safe through durable claims, deterministic engine message IDs,
  transcript reconciliation, restart pagination, and production startup
  recovery.
- Scoped every Activity source query by the authenticated/mobile user before
  previews or reports leave the database. The local desktop global view now
  requires an explicit trusted policy.
- Added SQLite/Postgres owner columns, Activity indexes, and Postgres
  `agent_sessions` query-column parity.
- Added focused regressions for a second completion batch, an accepted wake
  recovered after a crash without duplicate prompt, and 101 stale parents
  recovered through 25-parent pages.

## Checks

- `cd apps/opencode_fork/packages/opencode && bun run build --single` — pass;
  standalone binary smoke reported the branch-built version.
- `cd apps/api_server && npm run build` — pass.
- `cd apps/api_server && npm run lint` — command exits 0 but currently prints
  the repository placeholder `TODO: add eslint`.
- `cd apps/api_server && npx vitest run
  src/__tests__/issue_1123_contract.test.ts
  src/services/__tests__/agent_activity_service.test.ts
  src/__tests__/issue_1172_agent_activity_routes.test.ts
  src/contract/issue_1175_security_review.test.ts
  -t 'issue-1123|issue-1172|issue-1175-c(8|9|10|16)|returns
  canonical|requires a live' --reporter=verbose` — 16 pass, 2 unrelated
  criteria skip.
- Live sandbox used branch-built API/fork on API `:5298` and engine `:5297`
  with a copied database and isolated home/vault. Corrected attested Activity
  command:

  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:5298
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:5297
  DB_PATH=/tmp/rhythm-1175-delegation-activity.D5OVur/rhythm.db
  RHYTHM_LIVE_DB_PATH=/tmp/rhythm-1175-delegation-activity.D5OVur/rhythm.db
  RHYTHM_SANDBOX_DIR=/tmp/rhythm-1175-delegation-activity.D5OVur
  npx vitest run
  src/__tests__/live_e2e_1172_agent_activity.test.ts
  --reporter=verbose` — 1/1 pass. The paired feed contained the authenticated
  user's human, scheduler, webhook, research, cookbook, and optimizer markers
  and excluded the other user's matching six sources and report/secret
  markers.
- Locked-participant live command with the same attestation and database:
  `npx vitest run src/__tests__/issue_1123_live_e2e.test.ts
  -t 'issue-1175-c8' --reporter=verbose` — 1 pass, 1 unrelated skip. Both a
  locked caller and locked target were rejected through the real HTTP route,
  and their engine child lists were unchanged.
- Existing real Gemini child-to-parent command:
  `npx vitest run src/__tests__/issue_1123_live_e2e.test.ts
  -t 'issue-1123-c6' --reporter=verbose` — failed after 193 seconds on the
  test's legacy `session.status && frame.working === false` completion wait.
  The captured real stream had already observed `CHILD_RECON_DONE`, one
  `[Async delegation update]` with its deterministic delivery marker, and
  `PARENT_WAKE_RECON`; the shared smoke assertion was not rewritten in this
  scoped workstream.
- Initial Activity live invocation was safely rejected before test data setup
  because its test process omitted `RHYTHM_LIVE_E2E_ISOLATED` and `DB_PATH`.
  Failure triage classified this as harness configuration; the corrected exact
  command above passed without changing code or assertions.
- `git diff --check` — pass.
- GitNexus `detect-changes` was invoked before commit but the CLI rejected this
  isolated worktree because it has no registered index and the repository name
  is ambiguous across concurrent worktrees. No foreign index was used as
  evidence; the integration owner will rebuild and run final aggregate
  compare-to-main analysis.
- Sandbox shutdown was ownership-checked against its exact command, ports
  `:5297`/`:5298` were released, and the exact temp directory was removed.

## Notes

- Activity rows with `NULL` owners are organization/system records: paired and
  authenticated per-user feeds exclude them; only the explicit trusted local
  desktop policy can request the global view.
- Wake claims remain durable while engine transcript inspection is ambiguous.
  Successful deterministic delivery becomes `notified`; definite rejection
  releases the claim for retry. Restart recovery reads bounded pages but
  traverses every parent rather than stranding parents beyond the first page.
- The fork build's incidental `apps/opencode_fork/bun.lock` rewrite was
  restored to branch baseline before commit. Dependency links were local,
  ignored, and removed before handoff.
