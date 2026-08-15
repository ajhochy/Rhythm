---
date: 2026-08-14
repo: Rhythm
branch: agent-stack/si-scope-safety
pr: null
issues: [W1]
status: verification-pending
tags: [run, Rhythm, optimizer, scope-safety]
---

# W1 scope containment and conflict-safe rollback

## Files

- Preserved and completed the existing W1 service/controller/test diff.
- Added narrow repository methods for one-statement proposal claim/snapshot persistence and SQLite
  config scope compare-and-set.
- Added SQLite/Postgres claim parity tests, config CAS tests, exact V2 binding/legacy regressions,
  recursive classifier cases, duplicate-array refusal, route ordering/failure/concurrency coverage,
  and a successful active-route V2 revert case.

## Checks

- Parent verification used `node --version` → `v22.23.1`.
- `npx vitest run src/__tests__/org_risk_classifier.test.ts src/__tests__/org_proposal_apply.test.ts src/__tests__/issue_831_contract.test.ts src/__tests__/issue_850_contract.test.ts src/__tests__/issue_857_contract.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/org_exercised_tools_resolver.test.ts src/__tests__/agent_org_proposals.test.ts src/__tests__/agent_org_proposals_postgres.test.ts src/repositories/agent_configs_repository.test.ts` → 10 files passed; 168 tests passed; 1 existing skip.
- Parent rerun `npx vitest run src/__tests__/org_proposals_routes.test.ts --no-file-parallelism` outside the restricted worker sandbox → 1 file passed; 17 tests passed.
- `npm run build` → passed (`tsc -p tsconfig.json` plus postbuild advisory copy).
- `git diff --check` and `git diff --check f9115de0` → passed.
- `python3 /tmp/git_added_scan.py f9115de0` → 1,629 added lines scanned; zero hits.
- `gitnexus detect-changes --repo Rhythm --scope compare --base-ref f9115de0 --limit 200` → 18 files, 45 symbols, zero affected processes, low reported change risk. The canonical index warned it was five commits stale; a worktree-local refresh failed in GitNexus's parsed-file shard writer.

## Notes

- The Codex worker sandbox denied `listen` with `EPERM`; the parent reran the same real-HTTP in-memory
  route suite in the normal Node 22 environment and it passed 17/17.
- No live DB, production api_server, engine, production service, remote branch, PR, or integration/W2/W3 code
  was touched.

## Corrective cycle 2

- Deleted the obsolete unattended scope mutation dispatch and implementation. Direct or nested
  scope-shaped payloads and every removal-alias presence now classify high; direct scope payloads
  are independently refused by unattended apply without proposal/config/profile/measurement writes.
- Made profile projection return status a scope apply/revert gate. `blocked`/`failed` results attempt
  exact CAS compensation, surface conflict, preserve the durable applied snapshot on approval, keep
  reverts active, and never overwrite a concurrent value when compensation loses.
- Added the documented local operator actor sentinel (`0`) and atomically bound exact scope
  `change_json` with actor and V2 snapshot in the winning claim.
- Rejected `__proto__`, `constructor`, and `prototype` after trimming in human scope validation,
  V2 snapshot creation, and stored-snapshot recognition.
- RED evidence: ambiguous unattended scope cases failed 7 assertions; projection-gate cases failed
  6 assertions; controller claim binding failed with actor `null` and change `undefined`; reserved-name
  cases failed 12 assertions. Each slice was made green before starting the next.
- Node 22 non-socket corrective gate:
  `npx vitest run src/__tests__/org_risk_classifier.test.ts src/__tests__/org_proposal_apply.test.ts src/__tests__/issue_831_contract.test.ts src/__tests__/issue_850_contract.test.ts src/__tests__/issue_857_contract.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/org_exercised_tools_resolver.test.ts src/__tests__/agent_org_proposals.test.ts src/__tests__/agent_org_proposals_postgres.test.ts src/repositories/agent_configs_repository.test.ts --no-file-parallelism`
  → 10 files passed; 194 tests passed; 1 existing skip.
- `npm run build` passed. `git diff --check 1699ff55` passed.
  `python3 /tmp/git_added_scan.py 1699ff55` scanned 575 added lines with zero hits.
  GitNexus compare against `1699ff55` reported 12 files, 21 symbols, zero affected processes, low
  risk, with its canonical-index six-commit staleness warning.
- The real HTTP route suite could not start in the Codex sandbox (`listen EPERM 0.0.0.0`). Parent
  reran the complete 11-file command externally under Node 22: 11 files passed, 213 tests passed,
  1 existing skip, including 19/19 route tests; `npm run build` passed. Status remains
  verification-pending until independent review passes.
