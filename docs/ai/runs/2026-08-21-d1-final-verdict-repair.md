---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1427, 1428]
status: ready-for-verification
tags: [run, Rhythm, repair]
---

## Contract

AJ-authorized second, narrowly-bounded repair loop on top of `76692b37`
(itself the first repair, covering #1426-#1428), after an independent agent
(GPT) reproduced the same fail-closed invariant gap: "attempted" was being
treated as "succeeded." #1429/#1430 remain explicitly out of scope; #1426
(secret sanitization) was not touched by this pass. See the `repair_2` block
in each of `docs/ai/contracts/issue-1427.json` and
`docs/ai/contracts/issue-1428.json` for per-issue detail; this note covers
the whole pass.

### Blockers

1. **Blocker 1** (#1427) — a real Docker reproducer (`local-script` installs
   `broken-tool`, whose `--version`/`--help` both exit 1) returned
   `{"verdict":"safe","reason":null,"testPromptsRunCount":2}`. Install and
   per-scenario exit codes were logged but never gated on.
2. **Blocker 2** (#1427) — `classifyVerdict` never inspected
   `credentialAccessAttemptsCount`; an observation with
   `credentialAccessAttemptsCount: 1` and zero forbidden-path violations
   returned `verdict: 'safe'`.
3. **Boundary hardening** (#1428) — `validateToolInstallChange`'s
   installMethod-rejection reason echoed the raw untrusted
   `change.installMethod` value verbatim, the same untrusted-echo shape
   already fixed for `toolName`/`packageSource` in the first repair but
   missed for `installMethod`.

### RED confirmed before implementing

Per issue-1427.json's `criteria[9].repair_2_note`: 15 failed / 52 passed
against the pre-repair-2 tree for the new tests added this pass (real-Docker
`broken-tool` reproducer, `evaluateCandidateSucceeded` unit suite,
credential-access-unsafe fake-runtime cases, failed-candidate-with-network
case, installMethod-echo boundary case).

### GREEN

Implemented both blockers and the boundary hardening (see per-issue contract
`repair_2` blocks for the exact files) and confirmed every focused, adjacent,
and real-Docker test passes — see Checks run below.

## Files changed

- `apps/api_server/src/services/tool_sandbox_vetter.ts` — `SCENARIO_RESULT:<id>:<exitCode>` per-scenario result line (was a bare completion marker); new `evaluateCandidateSucceeded()` (install exit 0 AND an exact, well-formed, zero-exit result for every requested scenario id — missing/malformed/duplicate/mismatched/nonzero all `false`); `classifyVerdict` now returns `unsafe` on any credential access attempt and `unknown`/`sandbox_candidate_failed` whenever `candidateSucceeded` is `false`, ahead of the network-call check; `testPromptsRunCount` unchanged (real attempts, never zeroed, never implies success).
- `apps/api_server/src/services/__tests__/tool_sandbox_vetter.test.ts` — new real-Docker `broken-tool` reproducer (unknown/sandbox_candidate_failed/2 attempts/exact-container torn down); credential-access-unsafe fake-runtime cases (including priority over a network call); `evaluateCandidateSucceeded` unit suite (install-nonzero, one-scenario-nonzero, missing/malformed/duplicate/mismatched); updated network-call fixture to also succeed so it still legitimately reaches `conditional` under the new success-gated rule; new negative case proving a failed candidate with a network call observed stays `unknown`, never `conditional`.
- `apps/api_server/src/services/tool_install_proposal_validator.ts` — installMethod rejection reason no longer echoes `change.installMethod`; returns only the fixed message + closed allowed-methods list.
- `apps/api_server/src/services/__tests__/tool_install_proposal_validator.test.ts` — new case: unsupported installMethod containing a secret-shaped token is rejected without the raw value or the token appearing in the reason.
- `docs/ai/contracts/issue-1427.json`, `issue-1428.json` — `repair_2` blocks + updated criteria/judgment_calls.
- `docs/ai/runs/2026-08-21-d1-final-verdict-repair.md` (this file).

## Checks run

- `cd apps/api_server && PATH="/opt/homebrew/opt/node@22/bin:$PATH" npx vitest run src/models/__tests__/tool_safety_report.test.ts src/repositories/__tests__/tool_safety_reports_repository.test.ts src/services/__tests__/tool_sandbox_vetter.test.ts src/services/__tests__/tool_sandbox_vetter_hardening.test.ts src/services/__tests__/tool_install_proposal_validator.test.ts src/__tests__/org_proposal_apply.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts` — **7 Test Files passed (7), 204 tests passed (204)**, including the full real-Docker suite (`tool_sandbox_vetter.test.ts`'s `D1.2 DockerSandboxRuntime — real container lifecycle` describe block ran live, non-skipped — confirmed via verbose reporter, each real-Docker case taking hundreds of ms to several seconds).
- Parent's two adversarial probes re-run verbatim against this exact dirty tree (via a temporary, uncommitted vitest file, deleted immediately after capturing output — never part of the committed diff):
  - Real Docker: `local-script` installs `broken-tool` (`--version`/`--help` both exit 1), scenarios `version-check`,`help-check` → observed `{"verdict":"unknown","reason":"sandbox_candidate_failed","testPromptsRunCount":2}`. **NOT safe**, as required.
  - Injected observation with `credentialAccessAttemptsCount: 1` → observed `{"verdict":"unsafe","credentialAccessAttemptsCount":1}`. **unsafe**, as required.
- `docker ps -a --filter "name=rhythm-d1-vet-"` — empty both before and after the full run (zero owned containers survive).
- `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npx tsc --noEmit` (apps/api_server) — passed, no output.
- `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build` (apps/api_server) — passed (incl. postbuild).
- `git diff --check` — clean (exit 0).
- Added-line secret scan (`git diff -U0 -- apps/api_server/src/services docs/ai/contracts | grep '^+' | grep -Ei "sk-|api[_-]?key|secret|password|token"`) — every hit is the intentional secret-shaped fixture token (`sk-abcdefghijklmnopqrstuvwx`) used by the new "never echo the untrusted value" test case, or contract prose describing that same test case; no real secret.

## GitNexus

- `gitnexus detect-changes --scope staged` errors "Multiple repositories indexed... specify with repo" against the full indexed-repo list, which does not include this worktree (`d1-tool-vetting`) — same failure mode recorded in every prior D1 run note. Recorded as **UNKNOWN**, not "no impact." `analyze`/`index` were not run (would risk rewriting `AGENTS.md`/`CLAUDE.md`); `git status` confirms neither file is modified.

## Residual risks

- The `not_tested` items already recorded in `issue-1427.json`/`issue-1428.json` (a real reachable-network install; a real-Docker OOM/corrupted-evidence-on-normal-exit case; D1.4/D1.5 sandbox-safety-gate wiring) remain not-tested, unchanged by this pass — out of scope by design, not a regression.
- `evaluateCandidateSucceeded` trusts `scenarioIds.length` as the exact requested-set size without re-deduplicating, relying on `validateScenarioIds` (upstream, unchanged) already rejecting duplicates before this function is reached — same judgment call as the first repair, unchanged.
- GitNexus impact analysis is UNKNOWN, not verified — this worktree has never been indexed.

## Notes

- #1426 (secret sanitization, `tool_safety_reports_repository.ts`) was NOT touched by this pass — it was fully addressed by the first 2026-08-21 repair and is not implicated by either of the two blockers reproduced here.
- #1429/#1430 were not implemented, `api_server` was not started, and no production data/config was touched.
