---
date: 2026-10-20
repo: Rhythm
branch: feature/playwright-ai-coverage
pr: null
issues: []
status: pending
tags: [run, Rhythm]
---

# Canonical MCP name: gated live transport contract

## Files

- `apps/api_server/src/__tests__/live_e2e_mcp_canonical_guidance.test.ts` is an isolated, opt-in behavioral test. The model response is scripted on a loopback Anthropic-compatible provider; the API, fork engine, stdio Rhythm MCP process, task endpoint, session, and permission checks are real.

## Checks

- Targeted TypeScript `--noEmit` of the new test: passed.
- Live sandbox test: **UNRUN**. The parent owns the guarded build and exclusive `tools/dev/sandbox.sh` lifecycle. Scripted-provider proof does not substitute for a separate native real-model Coordinator run.

## Exact parent-run sequence

Use the already approved, read-only synthetic baseline at `/private/tmp/rhythm-catalog-primary-fixture-20261020-a`. Inspect its `rhythm.db` and `opencode.json` ownership/modes and non-empty safe local MCP command map before launch; do not use operator config, DB, credentials, or ports. The test requires its synthetic session token to be `e02-synthetic-session-not-a-secret` and refuses another token. Build the exact fork, API, and MCP payloads with the repository build guard before `up` (unless the already reviewed exact build is present). In a shell at the active worktree root:

```bash
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-catalog-primary-fixture-20261020-a
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/opencode.json"
export RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-mcp-canonical-live-20261020
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  RHYTHM_LIVE_SYNTHETIC_TOKEN=e02-synthetic-session-not-a-secret \
  DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db" \
  bash -c 'cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/live_e2e_mcp_canonical_guidance.test.ts --reporter=verbose'
tools/dev/sandbox.sh down
```

Run `down` with the same four exported fixture/path variables even after a failed assertion, and record the live output, exact source/build identity, cleanup result, and listener state. `sandbox.sh` is the only authorized launcher; never start `api_server` by hand. If its security guard refuses a fixture or the claimed synthetic token differs, stop and retain the refusal as evidence.

The test creates one nonce-owned task, one restricted Agent Profile, and one agent session. It requires four actual `mcp_dispatch` parts: registered-name describe returning canonical `executeName`, bare-name execute denied, off-scope `obsidian` name denied, and canonical exact-ID task read succeeding through stdio MCP and API. It verifies the owned task's API row and deletes the owned session, profile, and task in that order. The off-scope name is absent from this baseline's only `rhythm` MCP server; this test establishes denial of that name, while the focused artifact contracts separately cover ambiguous and eligible-but-off-scope names. Neither test proves a sampled real model will recover from a denial; that remains native Coordinator qualification.

## Notes

- No live API, engine, MCP process, paid model, or sandbox was launched while authoring this contract.
- `RHYTHM_SANDBOX_PREBUILT_INTAKE` may relocate the MCP binary to `$RHYTHM_SANDBOX_DIR/mcp-dist/index.js`; the test accepts exactly the normal or intake path and still checks the loopback API/token projection.
