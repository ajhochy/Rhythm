---
date: 2026-10-21
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm, playwright, local-build]
---

# AI repair and fresh local qualification

## Files

- The MCP renderer now waits for authenticated setup before its first catalog read; both Settings and Profiles cancel reads when leaving the screen.
- Background tier routing now consults the live permitted model catalog instead of choosing an unauthenticated static Claude route. Explicit model overrides retain precedence. The managed title model is reconciled again after the engine starts, because the initial pre-spawn pass cannot inspect a live catalog.
- Catalog/schedule/research reload observers identify the new document's requests and consume their bodies before navigating again. The strict UI/backend assertions remain.
- New checked private tests cover Hermes OpenAI/Luna, two concurrent Coordinator jobs, and automatic conversation names; private account-fallback coverage exercises the actual bundled Claude plugin against local HTTP servers.

## Checks

- Exact signed b7d5 router/main Auto/MCP selection: 19/19, 108.468 seconds, no skipped/flaky/unexpected cases; run and fixture scrub exit 0. Report `/private/tmp/rhythm-b7d5-qualification-launch-20261020/router19-AWpXpR/report.json`.
- Exact signed b7d5 checked Hermes: 1/1, 68.602 seconds total, CLI 0. Report `/private/tmp/rhythm-hermes-one-turn-checked-BCRn0K/turn-report.json`. Whole fixture scrubbed, source hashes unchanged, dynamic Hermes port free and secret file absent.
- Fresh b7d5 Coordinator: 1 failed, 108.896 seconds, CLI 1. Both actual jobs, separate commits, overlap, exact wake counts and completed post-wake reports passed. Unexpected-error audit caught a separate background skill-extraction run selecting unavailable `anthropic/claude-haiku-4-5` and failing `ProviderModelNotFoundError`. Report `/private/tmp/rhythm-coordinator-two-goal-checked-20261020/output-qazWVl/report.json`; brGZYQ scrubbed with unchanged source hashes. The audit was not relaxed.
- Improved b7d5 auto-name diagnostic: 1/1, 42.2 seconds total, CLI 0, following the earlier checked placeholder-title failure. In the successful run no managed small_model was configured; a private field-only engine-log projection observed the title call using OpenAI/gpt-6-luna. This does not establish the cause of the previous intermittent failure or erase it.
- MCP controlled browser contract: original 2 failed/1 passed, expanded 4 failed/1 passed before source change; 5/5 after. Nearby Settings/Profiles 7/7 and gateway source assertions 13/13. See `2026-10-21-mcp-readiness.md`; these are browser/source checks, not fresh packaged proof.
- Claude plugin local-server coverage initially exposed test-fixture notification cross-talk: fire-and-forget spillover events from one case arrived during the next case using the same SDK ID. Unique per-case identities and event correlation preserve the behavior checks. Final command `npm run build:guard -- bash -c 'cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/anthropic_plugin_routing.test.ts --reporter=verbose'`: 15/15, exit 0, 1.38 seconds. Log `/private/tmp/rhythm-anthropic-failover-final-20261021.log`. This is bundled-plugin transport proof, not a paid Claude account run.
- Expanded synthetic packaged selection: 86 cases discovered across 32 files, no UNVERIFIED markers. Includes the previous broad60 plus catalogs18, navigation3 and tasks5. Discovery is not execution. Private launcher `/private/tmp/rhythm-updated-final-qualification-20261021/launch-final.mjs` uses the guarded synthetic fixture runner and rejects any result other than exactly 86 expected cases with zero failures/skips/flakes/errors.
- New exact-source local build/sign, sandbox canonical-tool gate, expanded packaged selection and paid reruns: pending.

## Notes

GitNexus is 321 commits stale; low/unknown indexed impacts are supplemented by manual review. Background model selection and post-ready managed configuration have a HIGH shared runtime blast radius, reported to the user before edits. Authenticated MCP startup has moderate shared renderer scope. The new behavior remains a candidate until rebuilt local-app and live-backend qualification.

The original mega checkout and its three pre-existing dirty paths remain untouched. Only one active task worktree exists. No push, PR, merge, installation or release. Coverage remains incomplete: 78 active markers across 83 inventoried behavior groups are not cleared by these scoped checks.
