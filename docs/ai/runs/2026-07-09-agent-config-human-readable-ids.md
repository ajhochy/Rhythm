---
date: 2026-07-09
repo: Rhythm
branch: wt/960-945-ids
pr: null
issues: [945, 960]
status: verification-blocked
tags: [run, Rhythm]
---

# Agent Config Human-Readable IDs

## Files

- `apps/api_server/src/controllers/agent_configs_controller.ts` — accepts optional `body.id`, validates slug ids, returns 409 for existing rows and 400 for reserved ids.
- `apps/api_server/src/repositories/agent_configs_repository.ts` — derives a label slug when no id is supplied, falling back to UUID only for empty/reserved/colliding slugs.
- `apps/api_server/src/services/opencode_agent_writer.ts` — exports the existing CLI preset and opencode built-in id sets for reuse by create validation.
- `apps/api_server/src/services/generators/new_agent_generator.ts` — treats UUID-shaped org-optimizer create-agent slugs as absent and derives the applied id from the label.
- `apps/api_server/src/__tests__/agent_configs_routes.test.ts` — adds route coverage for custom id, invalid id, duplicate id, reserved id, and label-derived id.
- `apps/desktop_flutter/lib/features/agent_configs/models/agent_config.dart` and UI render sites — add/use `displayLabel` so agent titles do not show UUIDs.
- `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart` and skill chip/delete render sites — add/use `displayName` so skill titles do not show UUID names when a description exists.

## Checks

- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — failed because the linked dependency install is incomplete: missing modules include `ws`, `pg`, and `resend`; errors are outside touched files.
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit --pretty false 2>&1 | rg "agent_configs_controller|agent_configs_repository|opencode_agent_writer|new_agent_generator" || true` — no errors reported for touched TypeScript files.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/agent_configs_routes.test.ts` — failed before tests ran because `better-sqlite3` is missing from the linked `node_modules`.
- `cd apps/desktop_flutter && HOME=/tmp DART_SUPPRESS_ANALYTICS=true /Users/ajhochhalter/development/flutter/bin/cache/dart-sdk/bin/dart format --output=none --set-exit-if-changed <touched dart files>` — failed; formatter would rewrite large existing UI files and `flutter_lints` is missing from package resolution. Full formatting was not kept to avoid unrelated churn.
- `git diff --check` — passed.
- GitNexus `impact` / `detect_changes` — unavailable: no exposed GitNexus MCP tools, no `.gitnexus/run.cjs`, and `npx --no-install gitnexus detect_changes` attempted network access and failed with `ENOTFOUND`.

## Notes

- Reserved-id source reused: `opencode_agent_writer.ts` existing CLI model presets (`claude-code`, `codex`, `gemini-cli`, `opencode`) and opencode built-in/internal ids (`build`, `plan`, `explore`, `general`, `compaction`, `summary`, `title`).
- Slug regex enforced at create route: `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Existing untracked `apps/api_server/node_modules` and `apps/mcp_server/node_modules` were present before this run and left untouched.
