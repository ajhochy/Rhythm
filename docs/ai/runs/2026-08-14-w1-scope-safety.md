---
date: 2026-08-14
repo: Rhythm
branch: agent-stack/si-scope-safety
pr: null
issues: [W1]
status: corrective-in-progress
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

## Corrective cycle 3

- Unified every human-gated scope write behind one deferred preparation/apply helper. The reviewed
  removal-only `scope-delta-v2` shape is unchanged; refine-scope, core-permission mutations, and
  broaden-scope now use `scope-state-v2`, bound to exact prior/applied/change bytes and hashes.
- Added fixed-column `corePermissionsJson` CAS, exact-state revert validation/compensation, generic
  legacy refusal for all three scope fields, claim-trigger regressions, actual writer return probes,
  compensation-race coverage, behavioral rerun coverage, and exact-byte/tamper matrices.
- RED evidence against the corrective-cycle-2 head:
  - repository CAS: 2 failures (`Unsupported agent config scope field: corePermissionsJson`);
  - snapshot/revert: 5 failures (missing `createScopeStateV2Snapshot`; generic core snapshot reverted);
  - constructor validation: 4 failures (empty change, target mismatch, field mismatch, no-op accepted);
  - deferred preparation: 4 failures (refine/broaden mutated during preparation).
- GREEN in the Codex sandbox under Node 22:
  - non-socket corrective command (the requested set minus `org_proposals_routes.test.ts`) passed:
    11 files, 257 tests passed, 1 existing skip;
  - `npm run build` passed (`tsc -p tsconfig.json` plus postbuild advisory copy);
  - actual writer probes passed for `written`, `skipped`, `blocked`, and `failed` on allowlist and
    core-permission approval, plus actual `blocked|failed` revert compensation.
- The exact 12-file command reached `org_proposals_routes.test.ts` but its real-server hook could not
  bind. A direct listener probe returned exactly
  `listen EPERM: operation not permitted 0.0.0.0`; parent external route verification remains
  required. The run status intentionally remains `corrective-in-progress`.
- `git diff --check 79ee9e8e` passed. A temporary-index scan covering all 12 files and the new
  contract inspected 1,427 added lines with zero secret, dynamic-execution, shell-exec, unsafe-mode,
  or nonlocal-HTTP findings. The
  mandatory GitNexus change detector could not register this worktree because the sandbox refused
  `~/.gitnexus/registry.json.tmp` with `EPERM`; pre-edit impact analysis still identified
  `revertProposal` as HIGH risk (15 upstream impacts), which is why its adversarial revert matrix
  is included in the corrective gate.
- The real linked-worktree index is also outside the writable sandbox at
  `/Users/ajhochhalter/Documents/Rhythm/.git/worktrees/w1-scope/index`; the commit step is blocked
  locally by `index.lock: Operation not permitted` and must be completed by the parent environment.
- Worker result: implementation and verification ran in-process with no sub-agent dispatch because
  the corrective shares the same production/test files and parallel editing would increase conflict
  risk. No W2/W3/integration/live DB/persistent server/network action was performed.
- Parent external verification under Node 22 passed the complete 12-file command: 12 files passed,
  284 tests passed, 1 existing skip, including 23/23 real HTTP route tests; `npm run build` passed.
- Parent review additionally made mixed/add/core scope preparation reject malformed JSON,
  mixed-type allowlist arrays, scalar allowlists, and non-object core-permission state before claim or
  projection; four new regressions passed. Status is verification-pending until independent review.
- Independent review of `47bd426e` failed closed with seven P1s: v2 snapshots lacked complete
  semantic/kind binding, ambiguous operations were normalized, recursive core-scope risk detection
  was incomplete, delta snapshots did not bind exact change bytes, and a failed final status update
  could leave restored target bytes under an active proposal. Corrective cycle 4 is in progress.

## Corrective cycle 4

- Added one pure strict mutation contract shared by refine, broaden, delta/state snapshot creation,
  recognition, semantic replay, and revert. Both v2 shapes now bind the allowed proposal kind,
  exact prior/applied bytes, exact `change_json` hash, target/field, and semantic proof; old or
  incomplete shapes refuse closed.
- Ambiguous live operations now reject before claim: duplicate current/requested entries, empty
  present operations, overlaps, stale removals/unsets, existing additions, mixed/scalar/malformed
  state, unsupported keys/shapes, reserved identifiers, and semantic no-ops. Normal array,
  ordinary-key tools-map, and core set/unset controls remain supported.
- Recursive risk detection now treats scope-shaped core payloads as HIGH even under a mislabeled
  text kind, while unrelated prose containing `set`/`unset` remains LOW.
- A failed/null/non-durable final `reverted` transition now performs exact scope-only CAS back to the
  applied bytes and reprojects them. A lost compensation CAS preserves concurrent bytes and returns
  conflict; state and delta paths are covered with real in-memory SQLite failure triggers.
- RED against immutable `47bd426e`: the initial committed corrective test file reported 25 failed
  and 1 passed, reproducing all five reviewer probes. GREEN under Node `v22.23.1`: the final
  corrective file passed 38/38.
- Exact parent gate attempt: the route file could not enter its first test because `app.listen(0)`
  raised `listen EPERM: operation not permitted 0.0.0.0`; isolated rerun reproduced the same harness
  failure with 1 failed and 22 skipped. That first full attempt also exposed one config-doctor error
  wording mismatch; the strict validator was aligned to the existing contract wording, after which
  the remaining 11 requested files passed 261 tests with 1 existing skip. `npm run build` passed
  (`tsc` plus the advisory-copy postbuild).
- GitNexus compare against `main` completed with 25 files, 102 symbols, zero affected processes, and
  low reported risk. Pre-edit analysis separately classified `revertProposal` CRITICAL and
  `classifyProposalRisk` HIGH, so both received adversarial lifecycle/risk regressions.
- No live Rhythm/OpenCode DB, persistent server, network, W2/W3, integration, or raw scope/profile
  logging was used. Status remains corrective-in-progress pending the external Node 22 route rerun
  and independent review.
- Parent external verification under Node 22 passed the expanded complete gate: 13 files, 323 tests
  passed, 1 existing skip, including 23/23 real HTTP route tests and 39/39 corrective-4 tests;
  `npm run build` passed. The route assertion was corrected to test the duplicate-current condition
  it actually constructs; production validation was not weakened.
- Parent lifecycle review added and passed an after-durable-commit regression: if a status writer
  throws after `reverted` is already durable, reversion remains successful and target compensation
  is not run. Status is verification-pending until fresh independent review.

## Corrective cycle 5

- Independent semantic and lifecycle reviewers both failed `db78072b`. Their complete reports are
  `subagent-summary-0-20260814_203941_736647.txt` and
  `subagent-summary-1-20260814_203941_737447.txt` under the Hermes delegation cache.
- Parent reproduced the RED reviewer scripts under Node 22. Confirmed blockers include duplicate raw
  JSON members, smuggled sibling scope operations, null unrestricted allowlists narrowed as empty,
  runtime snapshot-kind gaps, incomplete shared scope detection, mislabeled scope status changes,
  nullable direct claim actors, stale source-status writes, and one-sided compensation after an
  ambiguous durable revert commit.
- Corrective 5 replaces catch-path compensation as the source of truth: generic status transitions
  become source-status CAS, and scope target/status reversion becomes one atomic database transition.
  Duplicate-aware parsing and one shared scope-bearing detector guard validation, risk, unattended
  apply, snapshot construction/verification, and revert before any side effect.
- Status remains corrective-in-progress. W1 is unaccepted and unmerged.

### Corrective cycle 5 implementation evidence

- Added one strict raw-JSON boundary that lexically rejects duplicate decoded member names before
  ordinary parsing, including nested, array-contained, and escape-equivalent keys. It now guards
  proposal changes, scope prior/applied bytes, and raw snapshots without changing hash input bytes.
- Unified recursive scope-bearing detection across risk, unattended apply, human preparation, and
  revert; preserved low risk for unrelated recipe operations and opaque prose. Null MCP/skill
  allowlists remain unrestricted and reject add/remove. Runtime proposal-kind families and
  refine-scope's single canonical root patch are enforced.
- Generic status writes now use exact source-status CAS plus `RETURNING *` in SQLite and PostgreSQL.
  Scope revert now uses one fixed-column SQLite transaction for target and bound proposal rows;
  PostgreSQL split-store scope revert refuses before either write. Failed projection invokes one
  exact atomic inverse, and ambiguous errors return `reconciliation-required` without one-sided
  compensation.
- Strict RED→GREEN slices under Node `v22.23.1`: parser 13 failed → 13 passed; null/kind/smuggling
  10 failed with 1 control passing → 11 passed; shared detector 10 failed → combined risk 43 passed;
  source-status CAS 3 failed → 3 passed; lifecycle 9 failed with 3 controls passing → lifecycle
  matrix green; actor guard 6 failed with actor 0 passing → 7 passed.
- Focused corrective-5 plus PostgreSQL parity: 2 files, 75/75 passed. Migrated corrective-4/#831
  tests: 2 files, 63 passed with 1 existing skip. The final legacy-helper boundary audit found
  `computeScopeList` still used ordinary parsing; GitNexus rated it HIGH (3 direct/7 upstream), so
  its map/array parsing was switched to the same strict parser and its focused controls passed
  78/78. Requested non-route matrix then passed 13 files, 366 tests with 1 existing skip.
  `npm run build` passed; `git diff --check db78072b` passed.
- Exact 14-file command was attempted unchanged. The sandbox denied `app.listen(0)` with exactly
  `listen EPERM: operation not permitted 0.0.0.0`; all 23 route hooks timed out, while the first
  attempt also exposed six obsolete adjacent-test assumptions that were migrated and then passed.
  Parent must rerun the route suite externally. No persistent server was started.
- `npx tsx` itself is unavailable here because its IPC listener is denied. With the safe equivalent
  `node --import tsx`, `w1-adversarial-probes.ts` now stops at the formerly accepted duplicate `add`
  with a duplicate-member rejection, and `w1-final-adversarial-probes.ts` stops at the formerly
  unsafe stale writer with a source-status conflict. The scripts do not catch these newly thrown
  fail-closed results, so the equivalent attacks and side-effect assertions live permanently in
  `w1_corrective_5_contract.test.ts` and adjacent repository tests.
- GitNexus `detect-changes --scope compare --base-ref main` was attempted. The registry first
  required disambiguation between two `Rhythm` indexes; the disambiguated integration index then
  refused because `agent-stack/si-scope-safety` is not an indexed branch. Pre-edit impact checks
  still ran against the indexed integration graph, including the HIGH-risk lifecycle/classifier
  symbols and the final HIGH `computeScopeList` audit. The parent must rerun change detection from
  an environment that can index this linked-worktree branch.
- No live database, network, persistent server, W2/W3/integration checkout, raw payload logging,
  commit, push, or PR action occurred. Status remains `corrective-in-progress`; acceptance is not
  claimed.

### Parent corrective-5 verification

- Parent review added six RED regressions beyond the worker result: nested operations below an
  agent-config id/typed target, repeated compensating-projection failure, oversized actor ids, and
  truthful HTTP reporting after an indeterminate post-commit exception. All six failed before the
  production follow-up and the focused real-route matrix then passed 93/93.
- Authoritative Node `v22.23.1` exact requested gate passed: 14/14 files, 396 tests passed, 1
  existing skip, including the ephemeral real HTTP route suite. `npm run build` and
  `git diff --check db78072b` passed.
- Both original independent-review scripts were rerun with `node --import tsx`: the first now stops
  at the formerly accepted duplicate `add` with a duplicate-member rejection; the second now stops
  at the formerly unsafe stale writer with a source-status conflict. Their complete attack paths and
  side-effect assertions are retained in permanent tests.
- No live database, persistent server, external network, W2/W3, or integration checkout was used.
  Corrective 5 is verification-pending, not accepted; two fresh independent review lanes are next.
