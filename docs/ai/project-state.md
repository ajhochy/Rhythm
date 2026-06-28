# Project State

## Current focus

**2026-06-27 — Issue #765 fix fully verified (backend + e2e).** All three
layers fixed and confirmed working:

1. `UpdatedInfo` schema in fork `session.ts` — `mcpAllowlist` field added so
   Effect.js validation no longer strips it.
2. `toPartialRow` in fork `session/projectors.ts` — `mcp_allowlist` column
   mapping added so the projector writes the value to SQLite.
3. `ws_gateway.ts` + `opencode_client_service.ts` — `updateSessionAllowlist`
   call after scope resolution (covers pre-existing, re-attached, and new
   sessions).

E2e smoke (2026-06-27):
- Direct PATCH → DB: `mcp_allowlist = {"servers":["rhythm"],"tools":[]}` ✓
- WS turn with `agent:'secretary'` → DB:
  `mcp_allowlist = {"servers":["pco-services","rhythm","obsidian","gmail-personal","gmail-work","calendar","pdf-tools"],"tools":[]}` ✓

## Active branch / PR

- **Branch:** `codex/fix-secretary-agent-scope`
- **HEAD:** `ed61e632d`
- **PR:** [#771](https://github.com/ajhochy/Rhythm/pull/771), open against main

Also open:
- **PR #763** (`fix/issue-761-agents-ui-render`) — agents UI live render + bus
  routing fix; awaiting merge.

## In progress

- PR #771 ready to merge. Manual live smoke via the Flutter app is the
  remaining optional step.

## Risks / known issues

- **Known limitation**: if the user switches from a restricted profile back to
  an unrestricted one mid-session, the fork session retains the last-set
  allowlist. Acceptable for the current smoke criterion.
- Fork binary is gitignored; rebuilt at `202606280319` and in main repo at
  `apps/api_server/opencode_bin/opencode`.
- Live UI smoke used the old `Rhythm-759-smoke.app` bundle (wrong binary).
  Backend e2e with the dev api_server + new fork was used instead and passed.

## Test status

- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 150 files, 1285 tests, all passed
- Direct PATCH smoke → `mcp_allowlist` written to DB ✓
- E2e WS turn (agent=secretary) → `mcp_allowlist` = Secretary allowlist ✓

## Next step

Merge PR #771 after final human review.
