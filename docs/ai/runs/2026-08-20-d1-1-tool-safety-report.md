---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1426]
status: ready-for-verification
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/issue-1426.json`
- RED confirmed: `npx vitest run src/repositories/__tests__/tool_safety_reports_repository.test.ts` failed with
  `Cannot find module '../tool_safety_reports_repository'` before the repository file existed. The model
  test passed immediately (model file was written first, alongside its test) — the round-trip/enum tests
  are trivial mapping logic with no separate RED window worth forcing.

## Files changed

- `apps/api_server/src/models/tool_safety_report.ts` (new)
- `apps/api_server/src/models/__tests__/tool_safety_report.test.ts` (new)
- `apps/api_server/src/repositories/tool_safety_reports_repository.ts` (new)
- `apps/api_server/src/repositories/__tests__/tool_safety_reports_repository.test.ts` (new)
- `apps/api_server/src/database/migrations.ts` (additive: `tool_safety_reports` table + index)
- `apps/api_server/src/database/postgres_bootstrap.ts` (additive parity: same table + index)
- `apps/api_server/src/__tests__/skill_schema_parity.test.ts` (added `tool_safety_reports` to the TABLES parity loop)
- `docs/ai/contracts/issue-1426.json` (new)

## Checks run

- `npx vitest run src/models/__tests__/tool_safety_report.test.ts src/repositories/__tests__/tool_safety_reports_repository.test.ts src/__tests__/skill_schema_parity.test.ts` — 34/34 passed.
- `npx vitest run src/__tests__/agent_org_proposals.test.ts src/__tests__/agent_org_proposals_postgres.test.ts src/__tests__/org_proposals_routes.test.ts src/__tests__/org_proposal_apply.test.ts` — 176/176 passed (no regression to the existing proposal lifecycle).
- `node_modules/.bin/tsc --noEmit` — passed.
- `npm run build` — passed, including postbuild.
- `git diff --check --cached` — clean.
- Added-line secret scan (`git diff --cached | grep '^+' | grep -Ei "sk-|api[_-]?key|BEGIN .* PRIVATE KEY|postgres://...@|AKIA|ghp_"`) — only hits are the synthetic fixture strings `sk-abcdefghijklmnopqrstuvwx` in the redaction test (same fake-secret-shape convention already used by `post_apply_events_repository.test.ts`), not a real secret.

## GitNexus

- The integration index (`/Users/ajhochhalter/.hermes/worktrees/rhythm-self-improvement/integration`) is stale relative to this branch's base (40834d0 vs 7f3f6d1a) and does not have this worktree registered at all — `detect-changes` cannot bind to this worktree; recorded as UNKNOWN and substituted with direct `git diff`/caller inspection (above) per the track's dispatch instructions.
- `impact runMigrations` (upstream) against the stale integration index reported **HIGH** (12 direct callers spanning Repositories/Release/Database modules). This reflects `runMigrations`' sheer fan-out as the single schema-init entrypoint every repository's constructor falls back to, not risk from this specific edit: the change is a single new `CREATE TABLE IF NOT EXISTS` + one `CREATE INDEX IF NOT EXISTS` appended at the very end of the function body, identical in shape to the immediately-preceding `calibration_observations` addition (C6) and every other additive table in this file. No existing statement was touched. Verified safe by direct inspection (the new block is syntactically and semantically independent of every prior statement) and by the full proposals/schema-parity test run above passing unchanged.
- `impact runPostgresBootstrap` — LOW. `impact registerProposalValidator` — LOW (not used by this issue's commit, checked ahead of D1.3).

## Notes

- Scope: D1.1 is model + repository + migration only (matches D2.1's precedent for the equivalent post-apply-events phase). No proposal-kind, sandbox, or controller wiring lands in this commit — that is D1.2/D1.3/D1.4.
- No sandbox.sh behavioral check in this phase — no HTTP route or server-reachable behavior changed; the new table/repository has no entry point yet.
