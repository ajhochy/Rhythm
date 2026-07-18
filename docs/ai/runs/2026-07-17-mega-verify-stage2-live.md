---
date: 2026-07-17
repo: Rhythm
branch: mega/opencode-utilization-1042-1108
pr: (pending draft)
issues: [1088, 1073, 1057, 1070, 1094, 1048, 1042, 1049, 1050, 1058, 1060]
status: green
tags: [run, rhythm, mega-pr, verification, live-e2e]
---

# Stage 2 verification + live e2e resolution

## Summary

Stage 0/1/1b/2 merged into the integration branch. api_server build (tsc) clean,
full unit suite green except 18 pre-existing `memory_*` ENOENT failures (also fail
on `main` — test pollution, unrelated). Flutter suite green from the Stage-1b run
(921/921). This note records the LIVE e2e resolution, which required orchestrator-level
setup the verification subagent couldn't do.

## Live e2e environment

The `sandbox.sh` sandbox serves an ISOLATED backend: api :4098, engine :4097,
temp `DB_PATH`, isolated HOME. The live-E2E isolation guard (#1001) requires:

```
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
DB_PATH=<sandbox>/rhythm.db RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_ENGINE_URL=http://127.0.0.1:4097 HOME=<sandbox>/home
```

**Model:** sandbox isolation can't reach keychain-bound Anthropic OAuth, so live
runs use OpenRouter Haiku (auth present in sandbox `auth.json`):
`RHYTHM_LIVE_MODEL_PROVIDER=openrouter RHYTHM_LIVE_MODEL_ID=anthropic/claude-haiku-4.5`.
The affected live tests now default to this and honor those env overrides.

## Live e2e results — 6/6 PASS (run SERIALLY)

| Test | Result | Notes |
|------|--------|-------|
| live_e2e_1088_hidden_schedulable | PASS | hidden+schedulable specialist scheduled, ran as its real profile (agentKind=cfg.id), produced "acknowledged." via OpenRouter Haiku |
| live_e2e_1073_permission_roundtrip | PASS | websearch=deny enforced; no completed websearch tool call |
| live_e2e_1057_worktree | PASS | create→list→reset→remove via Rhythm /opencode/worktrees wrapper |
| live_e2e_1070_global_sse | PASS | single /global/event stream + resubscribe |
| live_e2e_1094_image_generation_grant | PASS | image_generation grantable per-profile, not via MCP allowlist |
| live_e2e_1048_engine_session_delete | PASS | hard delete → engine 404 |

## Test-authoring fixes made (product code was correct throughout)

All live-test failures were TEST bugs, not product defects:

1. **Response-shape mismatches** — tests read bare arrays where the API returns
   `{ sessions, resumable }` and `{ session, messages }`. Fixed to destructure.
2. **#1088 field name** — asserted `session.agentId` (doesn't exist); the
   profile id is carried in `agentKind` for profile-bound scheduled sessions.
3. **#1088 transcript role** — the message API tags the model turn `role: 'output'`
   (user turn `input`), not `assistant`. Extraction now accepts `output`/`assistant`.
4. **#1088/#1073 empty model id** — `{provider:'openrouter', id:''}` fell back to
   unauthenticated Claude Code. Now defaults to OpenRouter Haiku, env-overridable.
5. **#1057 wrong target** — test hit the raw engine `/experimental/worktree/*`
   with a stale payload shape; rewritten to drive Rhythm's `/opencode/worktrees`
   wrapper (the actual #1057 deliverable). List returns `string[]`, not objects.

## IMPORTANT operational note

**Live e2e tests share ONE live engine and MUST run serially.** Vitest's default
file-parallelism causes worktree/session contention (false failures). Run the live
gate with `--no-file-parallelism`. Verified: parallel = 1 flaky fail; serial = 6/6 pass.

## Unit baseline

- api_server: `npm run build` exit 0. Full suite: 3000 pass / 18 pre-existing
  memory_* fail / skips. `migrations_replay_guard` + `org_settings_schema_parity` green.
- Migration runOnce keys added this branch: issue_1058_worktree_fields,
  issue_1088_picker_schedule_fields, issue_1073_permissions_json,
  issue_1094_image_gen_capability, issue_1069_tool_events, issue_1072_org_settings
  (+ postgres_bootstrap org_settings additive table — only prod-schema change).
