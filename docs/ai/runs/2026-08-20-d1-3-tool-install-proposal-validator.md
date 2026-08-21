---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1428]
status: ready-for-verification
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/issue-1428.json`
- RED: recovered a pre-existing UNTRACKED test file (`tool_install_proposal_validator.test.ts`) left over from an earlier pass that hit a max-turn boundary before any implementation or wiring existed. First run failed on an unrelated bug in the skeleton itself (`configsRepo.create is not a function` — the repository's real method is `insert`), so RED was established by fixing that call, then confirming all 16 cases (7 original + 1 fixed assertion bug + 8 added for the test-prompt/install-method acceptance criteria the skeleton didn't yet cover) failed with "no re-validation is registered" / import errors before `tool_install_proposal_validator.ts` existed.
- GREEN: implemented `validateToolInstallChange` and registered it into `org_proposal_apply_service.ts`'s `validators` map (same inline-registration style as `create-agent`/`external-adoption`/`webhook-wiring`, since the test imports `validateProposalChange` directly with no wiring-bootstrap call). 16/16 GREEN on first full implementation pass.

## Files changed

- `apps/api_server/src/services/tool_install_proposal_validator.ts` (new)
- `apps/api_server/src/services/org_proposal_apply_service.ts` (register `tool-install` validator)
- `apps/api_server/src/services/__tests__/tool_install_proposal_validator.test.ts` (recovered untracked file; fixed the `configsRepo.create`/`.insert` and `result.reason` skeleton bugs; added `testPrompts` to the shared fixture and 8 new cases)
- `docs/ai/contracts/issue-1428.json` (new)

## Checks run

- `npx vitest run src/services/__tests__/tool_install_proposal_validator.test.ts` — 16/16 passed.
- Adjacent: `org_proposal_apply_service.test.ts`, `proposal_evidence_validator.test.ts`, `tool_sandbox_vetter.test.ts`, `tool_safety_report.test.ts`, `tool_safety_reports_repository.test.ts` — 74/74 passed.
- Every test file importing `org_proposal_apply_service` (28 files across `__tests__`, `services/__tests__`, `services/generators/__tests__`, `contract/`) — 517 passed, 1 pre-existing skip, 0 failures.
- `node_modules/.bin/tsc --noEmit` — passed, no changes needed.
- `npm run build` — passed.
- `git diff --check` — clean.
- Added-line secret scan — only hit is the synthetic fixture `sk-abcdefghijklmnopqrstuvwx...` inside a test asserting that exact string is NOT present in the validator's rejection reason (same fake-secret convention as D1.1/D1.2's redaction tests).

## GitNexus

- `gitnexus detect-changes` (both bare and with `--repo <this worktree's absolute path>`) errored: this worktree is not present in the local GitNexus index registry at all (checked the full `Available:` list in the error output). Recorded as **UNKNOWN** — no impact analysis available, not claiming "no impact".
- New symbols this commit adds (`validateToolInstallChange`, `TOOL_INSTALL_ALLOWED_INSTALL_METHODS`, `isAllowedToolInstallMethod`, `TOOL_INSTALL_MAX_TEST_PROMPTS`, `TOOL_INSTALL_MAX_TEST_PROMPT_LENGTH`) have exactly one caller each today (the `validators['tool-install']` registration in `org_proposal_apply_service.ts`, and this issue's own test file) — no other code path reaches them yet, matching D1.1/D1.2's precedent that model/validator phases land ahead of any generator.
- The one EDITED existing symbol is `org_proposal_apply_service.ts`'s module-level `validators` map (one new key added, `'tool-install'`); no existing behavior for any other kind changed.

## Notes

- Scope boundary (enforced by not touching it): the sandbox-safety gate — refusing a proposal whose `tool_safety_reports` verdict is `unsafe`/`unknown` — is explicitly D1.4 (#1429) per this test file's own header comment. This validator is structural/schema-only.
- Check order inside `validateToolInstallChange` matters for one pre-existing test: `{toolName, packageSource, installMethod, agentConfigId}` present but both `evidenceBundle` and `testPrompts` missing must report `'evidenceBundle'` (that test's literal expectation), so evidenceBundle presence/shape is checked before testPrompts.
- `testPrompts` bounds (≤20 entries, ≤4000 chars/entry) are schema hygiene against unbounded `change_json` blobs, not a safety mechanism — chosen since no existing limit for this shape exists anywhere else in the codebase.
- Production install-method registry (`npm install`, `pip install`) deliberately excludes `tool_sandbox_vetter.ts`'s `local-script` TEST-ONLY escape hatch, closing the loop that module's own doc comment forward-referenced ("never accepted by the production proposal validator in D1.3").
- Two bugs found and fixed in the recovered test skeleton itself (unrelated to this issue's actual validation logic): `configsRepo.create(...)` doesn't exist (real method is `.insert({label, icon, ...})`), and asserting `.not.toMatch()` on `result.reason` when `result.valid === true` throws in vitest since `reason` is `undefined` on success (fixed with `result.reason ?? ''`).
