---
date: 2026-07-24
repo: Rhythm
branch: feature/creative-platform-integration
pr: null
issues: []
status: blocked
tags: [run, Rhythm, research]
---

## Files

- Added optional startup-validated `RHYTHM_RESEARCH_MODEL` parsing and the Deep Research runner override.
- Added focused config/runner tests and sandbox-only E2E instructions.

## Checks

- `PATH="/usr/local/bin:$PATH" npm exec -- vitest run src/__tests__/research_model_config.test.ts src/__tests__/agent_research_runner.test.ts` — 7 passed (Node v22.18.0).
- `PATH="/usr/local/bin:$PATH" npm run build` — passed.
- Restarted `tools/dev/sandbox.sh` with `RHYTHM_RESEARCH_MODEL=openrouter/openrouter/free`.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_VAULT_PATH="$TMPDIR/rhythm-dev-sandbox/vault" npm exec -- vitest run src/__tests__/agent_research_live_e2e.test.ts` — blocked: job errored because the sandbox engine reported `Agent not found: "research"`; the override was confirmed in the API log as `openrouter/openrouter/free`.

## Notes

The sandbox was stopped after the attempted live run. This is an existing sandbox profile projection issue, not an OpenRouter rate-limit result; the E2E did not reach a report or vault note.
