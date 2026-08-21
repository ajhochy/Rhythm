---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1426, 1427, 1428]
status: ready-for-verification
tags: [run, Rhythm, repair]
---

## Contract

One authorized focused repair loop over four blockers found in the committed
D1.1/D1.2/D1.3 work (commits `42cc0c0a`, `fa5f783d`, `1965011b`). D1.4
(#1429)/D1.5 (#1430) are explicitly out of scope. See the `repair` block
added to each of `docs/ai/contracts/issue-1426.json`,
`docs/ai/contracts/issue-1427.json`, `docs/ai/contracts/issue-1428.json` for
the per-issue detail; this note covers the whole pass.

### RED confirmed before implementing

After writing the new tests, shared modules (`tool_test_scenarios.ts`,
`tool_install_safety.ts`, `d1_secret_sanitizer.ts`) and implementation
changes, genuine RED was captured by surgically reverting ONLY the three
touched implementation files back to their `1965011b` (pre-repair) content
via `git stash push -- tool_sandbox_vetter.ts
tool_install_proposal_validator.ts tool_safety_reports_repository.ts`
(keeping every new/updated test file in place), then running:

```
npx vitest run src/repositories/__tests__/tool_safety_reports_repository.test.ts \
  src/services/__tests__/tool_install_proposal_validator.test.ts \
  src/services/__tests__/tool_sandbox_vetter.test.ts \
  src/services/__tests__/tool_sandbox_vetter_hardening.test.ts
```

Result: **32 failed / 28 passed** against the pre-repair implementation.
Representative failures, each pinned to one blocker:

- **Blocker B/C** (#1427): `vetToolInSandboxAsync` threw
  `TypeError: Cannot read properties of undefined (reading 'length')` at
  `input.testPrompts.length` for every case using the new `scenarioIds`
  field (the pre-repair code has no such field) — direct evidence the old
  contract never genuinely invoked per-scenario.
- **Blocker C** (#1427): `'the runtime throwing mid-run fails closed... never
  raw exception text'` failed with
  `Expected: "sandbox_error" / Received: "sandbox_error: container crashed
  with token sk-abcdefghijklmnopqrstuvwx leaked in output"` — the pre-repair
  code echoed the raw exception message (including the embedded fake secret)
  straight into the durable `reason` field. `'an unsupported install method
  fails closed...'` failed the same way (`Received: "sandbox_error:
  unsupported installMethod 'curl | sh' — cannot construct a sandbox install
  command"` vs the fixed `'unsupported_install_method'`). The timeout test
  hit vitest's own `Test timed out in 20000ms` (the pre-repair runtime has no
  `timeoutMs` override and never rejects on a signal-killed client), and the
  hardening test failed `expected [...] to include '--cap-drop'` (none of the
  new container-hardening flags exist pre-repair).
- **Blocker D** (#1428): every new closed-scenario test (2/3-accepted,
  1/4-rejected, unknown-id-rejected, duplicate-rejected) failed because the
  pre-repair `TOOL_INSTALL_MAX_TEST_PROMPTS`/`_LENGTH` constants accepted
  1-20 arbitrary strings — confirming the pre-repair schema really did allow
  raw prompt-shaped strings through.
- **Blocker A** (#1426): the pre-repair `createAsync` never sanitized the
  plain scalar columns at all (only the JSON blobs, via `redactSecrets`) —
  confirmed directly by reading the reverted file during this same stash
  window (no sanitizer call anywhere near `tool_name`/`tool_version`/
  `package_source`/`install_method`/`reason` in the `row` object).

`git stash pop` restored the repaired implementation immediately after
capturing this output; the full green suite (below) was re-run afterward to
confirm the round-trip introduced no corruption.

### GREEN

Implemented the four repairs (see per-issue contract `repair` blocks for the
exact files) and confirmed every focused, adjacent, and real-Docker test
passes — see Checks run below.

## Files changed

- `apps/api_server/src/services/d1_secret_sanitizer.ts` (new)
- `apps/api_server/src/services/__tests__/d1_secret_sanitizer.test.ts` (new)
- `apps/api_server/src/services/tool_test_scenarios.ts` (new)
- `apps/api_server/src/services/tool_install_safety.ts` (new)
- `apps/api_server/src/repositories/tool_safety_reports_repository.ts`
- `apps/api_server/src/repositories/__tests__/tool_safety_reports_repository.test.ts`
- `apps/api_server/src/services/tool_sandbox_vetter.ts`
- `apps/api_server/src/services/__tests__/tool_sandbox_vetter.test.ts`
- `apps/api_server/src/services/__tests__/tool_sandbox_vetter_hardening.test.ts` (new)
- `apps/api_server/src/services/tool_install_proposal_validator.ts`
- `apps/api_server/src/services/__tests__/tool_install_proposal_validator.test.ts`
- `docs/ai/contracts/issue-1426.json`, `issue-1427.json`, `issue-1428.json` (repair blocks + corrected criteria)
- `docs/ai/runs/2026-08-21-d1-repair-tool-vetting.md` (this file)

## Checks run

- `cd apps/api_server && npx vitest run src/models/__tests__/tool_safety_report.test.ts src/repositories/__tests__/tool_safety_reports_repository.test.ts src/__tests__/skill_schema_parity.test.ts src/services/__tests__/tool_sandbox_vetter.test.ts src/services/__tests__/tool_sandbox_vetter_hardening.test.ts src/services/__tests__/tool_install_proposal_validator.test.ts src/services/__tests__/d1_secret_sanitizer.test.ts` — 121/121 passed, including the full real-Docker suite (genuine 2/3-scenario invocation proof, real timeout/terminated fail-closed case, exact-container-name teardown proof).
- Adjacent: every test file importing `org_proposal_apply_service` (30 files, matched via `grep -rl org_proposal_apply_service`) — 553/554 passed, 1 pre-existing skip, 0 failures/regressions.
- Full repo suite: `npx vitest run` (no filter) — 5892 tests, 17 failures, all 17 confirmed PRE-EXISTING and unrelated (`TypeError: pool.connect is not a function` in unrelated Postgres-bootstrap schema-parity tests — reproduced identically against `git stash` of this repair's changes, i.e. present on the pre-repair tree too).
- `PATH="/opt/homebrew/opt/node@22/bin:$PATH" node_modules/.bin/tsc --noEmit` — passed.
- `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build` — passed (incl. postbuild).
- `git diff --check --cached` — clean.
- Added-line secret scan (`git diff --cached | grep '^+' | grep -Ei "sk-|api[_-]?key|BEGIN .* PRIVATE KEY|postgres://...@|mysql://...@|mongodb...://...@|AKIA|ghp_|xox[baprs]-|Bearer "`) — every hit isolated to the 5 test files that seed synthetic fake-secret fixtures (same established convention as the original D1.1-D1.3 commits) plus one doc-comment in `d1_secret_sanitizer.ts` naming the shapes it catches generically; no real secret.
- Docker container cleanup: `docker ps -a --filter "name=rhythm-d1-vet-"` returns empty after the full real-Docker suite run — zero owned containers survive, and none of this repair's teardown paths use a `--filter`/prefix-based removal (verified directly by `tool_sandbox_vetter_hardening.test.ts`'s mocked-spawn assertion that no teardown call contains `--filter`).

## GitNexus

- `gitnexus detect-changes --scope staged` errors "Multiple repositories indexed... specify with repo"; `--repo <this worktree's absolute path>` errors "not found" against the full indexed-repo list (same failure mode recorded in the original D1.1/D1.3 run notes — this worktree has never been registered in the local GitNexus index). Recorded as **UNKNOWN** — no impact analysis available, not claiming "no impact," consistent with the stale/no-symbol fallback posture used throughout this track.

## Notes

- D1.4 (#1429) and D1.5 (#1430) were NOT touched — the sandbox-safety gate (a `tool_safety_reports` row with a passing verdict blocking approval) and any UI/controller wiring remain out of scope for this repair, exactly as they were out of scope for the original commits.
- `ToolVettingInput.testPrompts` was renamed to `scenarioIds: string[]` (a TypeScript-only interface, not durable state) since nothing in this codebase wires the sandbox vetter to a real proposal yet (that wiring is D1.4) — free to rename without a compatibility shim. The proposal's `change_json.testPrompts` durable field KEEPS its name for compatibility per the repair brief, but its entries are now closed scenario identifiers, never prompt text.
- The container hardening flags (`--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit`, `--read-only` root + `/tmp` tmpfs, non-root `--user node`) were verified compatible with every existing real-Docker fixture on the first pass — no fixture needed adjustment beyond writing candidate "binaries" under the bind-mounted `/vet/bin` (chmod 0o777 host-side) instead of a host path outside the scratch workspace, since a `--read-only` root filesystem no longer permits writes anywhere else.
