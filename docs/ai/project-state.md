# Project State

## Current focus

opencode session-continuity bug fixes (#912 + #913) in the vendored fork,
plus a full audit of the agent system (profiles, delegation, skill/MCP
scoping) that produced 10 follow-up issues (#914–#923).

## Active branch / PR

- `issue-912-913-opencode-continuity` — combined fix for #912 and #913.
  PR about to open against `main` (Fixes #912, Fixes #913). Not merged.
- Prior session merged to `main` via PR #901 (config-doctor agent +
  doctor OAuth fix).

## In progress

- #912/#913 fixes implemented and verified (see run
  `2026-07-06-issue-912-913-opencode-continuity`). PR open, awaiting CI +
  manual smoke.
- Agent-system audit fixes (#914–#923) NOT yet started — separate branch
  planned (`agent-profiles-audit-fixes`); these are agent-profile/delegation
  data + code, deliberately kept out of the engine-continuity PR.

## Risks / known issues

- Both #912/#913 fixes live in the vendored `apps/opencode_fork` — keep the
  diffs minimal/tagged so they survive upstream merges. Test against the
  BUILT fork binary (set `RHYTHM_OPENCODE_BIN`), never the stock PATH binary
  (false-green risk).
- `#913 repairToolPairing` is a defensive repair at the request chokepoint —
  the true producer of the dangling `tool_use` was never located.
- `#913 autoContinueExhausted` resets on any completed tool call (coarse by
  design) — a session completing one trivial tool call per cycle could still
  loop; the cap is a backstop, not a guarantee.
- Audit HIGH findings still open: delegation caller-identity spoofing (#914),
  60s delegation timeout causing duplicate runs (#915), scope fail-open /
  config-doctor full surface (#916), nonexistent tool/server names in
  allowlists (#917).

## Test status

- api_server: `npx tsc --noEmit` clean; `npm test` 2405 passed / 1 skipped
  (280 files, 2 new tests).
- fork: targeted suites (compaction, transform, error, message-v2,
  processor-spurious) 330 pass / 0 fail; `bun run typecheck` clean except one
  pre-existing error in `test/session/system.test.ts` (proven byte-identical
  to `origin/main`).
- fork binary: `bun run build --single` RC=0 (smoke passed,
  version `0.0.0-issue-912-913-opencode-continuity-*`).
- Live-engine smoke on the BUILT fixed binary (:4012, dev-override): real
  secretary→librarian delegation with a tool call completed cleanly — no
  `tool_use…without tool_result` 400, no `reasoning part…not found`, no
  APIError; profile scoping applied live.

## Next step

1. Open the #912/#913 PR, watch CI, hand off for manual smoke.
2. Start the `agent-profiles-audit-fixes` branch for #914–#923 (durable
   data-repair migration + code): begin with the HIGH findings.
