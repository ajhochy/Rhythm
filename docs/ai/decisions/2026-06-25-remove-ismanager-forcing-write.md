---
date: 2026-06-25
repo: Rhythm
branch: fix/decouple-ismanager-importer
pr: "741"
tags: [decision, Rhythm, agent-sync, is_manager]
---

# Remove is_manager forcing write from OpenCode agent importer

## Context

`syncOpencodeAgentProfiles` in `agent_profile_sync.ts` contained:

```ts
const isManager = name === DEV_FRONT_DOOR_PRIMARY;
```

This variable was then passed into both the UPDATE patch and the INSERT call,
meaning every sync/restart **forced** `workflow-orchestrator.is_manager = true`.
This caused continuous churn: any time the user changed which profile was the
manager, the next sync silently reverted it.

PR #741's original commit (`feb9a7c`) added explanatory comments and guard tests
but **never deleted** the three offending lines. The bug persisted.

## Decision

1. **Delete the forcing variable and both its usage sites** — `is_manager` is
   now completely absent from `syncOpencodeAgentProfiles`. Fresh INSERTs receive
   the DB column DEFAULT (0/false); UPDATEs leave the existing value untouched.

2. **Extend `DEV_FRONT_DOOR_SECONDARY`** with `build`, `codex`, `gemini-cli`,
   and `opencode`. These CLI/system agents are imported as profiles (so
   programmatic callers can target them) but must never appear in the
   `AgentSelectorPill`. `claude-code` is intentionally NOT in this set — it is
   the user's escape hatch and must remain session-selectable.

3. **Update the guard test** (`issue-P4-manager-delegation-c6`) that previously
   asserted `isManager=true` for `workflow-orchestrator` after sync. The test
   now asserts `false` (importer never sets it) while keeping the
   `allowedDelegatesJson` assertions intact.

4. **Add three new tests**: CLI agents hidden after sync, claude-code stays
   selectable, re-sync stability for CLI agents.

## Alternatives considered

- **Leave the comment-only PR (#741) as-is.** Rejected — the bug was still live
  and caused real churn on every sync/restart.
- **Merge feature/agent-scheduler first then fix separately.** Accepted as the
  ordering constraint — PR #741 is now rebased onto `feature/agent-scheduler` so
  it can land on top cleanly.

## Consequences

- After #741 merges and the app rebuilds from `feature/agent-scheduler`, sync
  becomes idempotent with respect to `is_manager`.
- Any profile (Secretary, workflow-orchestrator, etc.) can be the manager and
  will survive re-syncs without manual correction.
- `build`, `codex`, `gemini-cli`, `opencode` will no longer appear in the
  session picker after the next sync.
- `claude-code` remains in the picker.
