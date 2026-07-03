---
date: 2026-07-02
repo: Rhythm
branch: issue-883-secretary-delegate
pr: null
issues: [883]
status: implemented-pending-verification-gate-fold
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #883 — secretary delegate authorization

Worktree: `883-secretary` (isolated, parallel to 7 other worktree agents this
run). Branch `issue-883-secretary-delegate`, commit `f33ecacd5`.

## Context

Secretary is a configured Manager profile (`is_manager = true`, roster
configured, system prompt already says "delegate to the approved specialist")
but was missing `rhythm_delegate` from its MCP tool scope — authorized to
delegate but no tool to invoke it. Investigating surfaced a deeper gap: the
manager flag and roster had **no canonical source anywhere in the repo** —
only ever set by hand via the Agent Profiles designer UI. A fresh database
would silently regress to a non-manager secretary with an empty roster.

## Files changed

- `.mcp-roles/secretary.mcp.json` — added `rhythm_delegate` to
  `mcpServers.rhythm.allowedTools` (the actual reported gap; this file is
  read LIVE by `resolveMcpRole()` at every session-create call, so this edit
  alone fixes the tool-scope gap with no separate sync step). Also added two
  new fields: `isManager: true` and `allowedDelegates` (roster: theologian,
  librarian, worship-planning, worship-production, AI-Trend-Researcher,
  Theological-Researcher, fantasy-gm).
- `.mcp-roles/README.md` — documented the new `isManager`/`allowedDelegates`
  role-file fields and how they reach `agent_configs`.
- `apps/api_server/src/services/secretary_delegation_seed.ts` (new) —
  backfill-only reconciliation of `agent_configs('secretary').is_manager` /
  `.allowed_delegates_json` from the role file's new fields. Only fires when
  the column is still at its unset default; never clobbers a value already
  set via the designer (same USER-OWNED overlay contract
  `agent_profile_sync.ts` already uses for the other overlay columns).
- `apps/api_server/src/services/agent_profile_sync.ts` — added one call to
  `seedSecretaryDelegation()` at the end of `syncOpencodeAgentProfiles()`
  (alongside the existing #858 `oc_agent` repair pass). `server.ts` boot was
  considered but rejected: `syncOpencodeAgentProfiles` is not invoked at
  server boot in this codebase, only fire-and-forget on
  `GET /agent-sessions/agents` and on-demand via
  `POST /agent-configs/sync-opencode` — chaining there guarantees the
  reconciliation runs once the `secretary` row genuinely exists.
- `apps/api_server/src/__tests__/secretary_delegation_seed.test.ts` (new, 15
  cases across two describe blocks): role-file assertions (`rhythm_delegate`
  present, `isManager`/`allowedDelegates` shape), backfill-on-fresh-row,
  idempotency, non-clobber of a human-set roster/is_manager, no-op on missing
  row / missing / malformed role file, exact-roster-from-custom-fixture.
- `apps/api_server/src/__tests__/secretary_delegation_authz.test.ts` (new, 5
  cases): secretary is a manager after seeding; secretary can delegate to
  every roster member read from the REAL role file (loop, real
  `delegateToAgent` call per member); rejects a non-roster target; regression
  — a non-manager profile still cannot delegate even holding the same roster.
- `docs/ai/decisions/2026-07-02-secretary-delegation-role-file-fields.md`
  (new) — full rationale, alternatives considered, consequences.

## Checks run

- `npx tsc --noEmit` — api_server ✓, mcp_server ✓ (both exit 0).
- `npx vitest run` (api_server, `--no-file-parallelism`) — **2023 passed / 1
  skipped / 0 failed** (236 files). Two earlier default-parallelism runs each
  hit one unrelated test timing out under 7-sibling-worktree resource
  contention (`notifications_agent_local_bypass.test.ts`, then
  `issue_755_role_separation.test.ts` — different file each time, neither
  references anything this change touches); both passed in isolation and the
  serialized run confirmed zero real failures.
- `npx vitest run` (mcp_server) — **59 passed** (11 files), including
  `agentDelegation.test.ts` (confirmed unaffected, as the issue predicted).
- `ai-workflow checks --level issue` — ✓ all green (flutter analyze, dart
  format, api_server tsc).
- `ai-workflow checks --level pr` — ✓ exit 0, all green (flutter analyze,
  dart format, api_server tsc, api_server vitest).

## Notes

**Roster scope decision:** the live local DB already had an 11-entry roster
(some UUID-keyed) set by hand — broader than the issue's stale "2 researchers
+ fantasy-gm" framing. Chose a 7-entry, slug-keyed subset
(theologian/librarian/worship-planning/worship-production +
AI-Trend-Researcher/Theological-Researcher + fantasy-gm) as the new canonical
role-file roster. Backfill-only semantics mean the live DB is untouched by
this change; the role file only matters for a fresh/reset database. See the
decision doc for full alternatives considered (deriving generically inside
`agent_profile_sync.ts`'s loop was rejected — the `is_manager` decoupling
there is a hard, test-enforced invariant).

**System prompt:** confirmed live via read-only DB inspection to already say
"Delegate domain work to the approved specialist instead of attempting it
yourself, then summarize the result" — matches the issue's claim. No
canonical source for it exists in this repo (only in the live DB and in
`~/.config/opencode/agents/secretary.md`, outside this worktree) — left
untouched per the issue's "only touch if canonical source lacks it"
instruction.

**Deviations from spec:** did not touch `agent_delegation_service.ts` or
`apps/mcp_server/src/tools/agentDelegation.ts` — issue confirmed, and this
run re-confirmed via passing tests, that both are already correct.

**Residual risks / follow-ups:**
- The two delegation rosters (`~/.config/opencode/agents/secretary.md`'s
  `task:` permission block, vs. `agent_configs.allowed_delegates_json`) are
  independently maintained and can drift — a future issue could reconcile
  them.
- The Allowed-Delegates UI's raw-UUID rendering (#883's "minor observations")
  was not addressed here — relates to #858, left as a separate follow-up.
- If the live DB's `allowed_delegates_json` for secretary is ever reset to
  null, it will re-seed to the new 7-entry slug roster, not the current
  broader 11-entry one — worth a one-line heads-up if that ever surprises
  someone.

## Next step

Fold into the mega-branch per this run's parallel-worktree pattern (matches
the other 7 sibling-worktree issues); no PR opened from this worktree
directly per the assignment ("No merge/push").
