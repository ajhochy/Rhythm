---
date: 2026-08-06
repo: Rhythm
tags: [decision, Rhythm, agents, opencode]
index: "[[Rhythm]]"
---

# Engine built-in agents are not selectable in Rhythm (except `build`)

## Context

The opencode engine's `GET /agent` returns its seven built-in agents alongside
Rhythm's own projected profiles: `build`, `plan`, `explore`, `general`,
`compaction`, `summary`, `title`. It does **not** set `builtIn` on them — measured
live 2026-08-06, that field came back `undefined` — so nothing in the payload
distinguished them from a real Rhythm agent. All seven appeared in the agent list
and in the desktop picker (43 entries).

AJ: "plan mode is a built in opencode agent that we do not use. it should not show
up in our agent list and our agents should not be able to delegate to it."

## Decision

Filter engine built-ins out of the agent listing at the controller boundary, via
`isSelectableEngineAgent()` in `opencode_agent_writer.ts`, with **`build` as the
only allow-listed exception**.

Three properties are deliberate:

1. **Fail-closed.** The predicate hides anything in `BUILTIN_OPENCODE_AGENT_IDS`
   unless explicitly allow-listed, so a built-in introduced by a future engine
   release stays out of the picker until someone decides it belongs there. The
   inverse (a denylist of known-bad ids) would silently leak the next one.
2. **`build` stays.** It is the engine's default agent and Rhythm explicitly falls
   back to it for an agent-less session. Hiding it would put the default outside
   the list of things a user can choose.
3. **Listing boundary only.** `refreshAgents` continues to reconcile profiles
   against the UNFILTERED engine list, pinned by test. Filtering the sync input
   too would make "hide from picker" silently mean "deactivate profile."

Separately, `buildTaskDelegatePermissions` now drops built-ins from the delegate
roster. The roster is spread after the natives, so a roster entry naming `plan`
would otherwise have overridden the `{"*": "deny"}` baseline.

## Alternatives considered

- **Filter only `plan`.** Matches the literal request, but `compaction`, `summary`
  and `title` are engine-internal pipeline agents and `explore`/`general` are
  `task`-only subagents — none is a thing a user starts a conversation as. Same
  defect, same root cause; fixing one of six would leave the rest leaking.
- **Filter on the engine's `mode` field.** `mode: 'subagent'` cleanly separates
  `explore`/`general`, but `build` and `plan` are both `mode: 'primary'`, so mode
  alone cannot express "keep the default, drop the unused primary."
- **Hide them in the Flutter client.** Cheaper, but leaves the API telling every
  consumer that `plan` is a valid agent. The server owns which agents exist.
- **Give `plan` a disabled `agent_configs` row.** Would reuse the existing #1135
  disabled-profile filter, but that writes a DB row for an agent Rhythm does not
  own, and `BUILTIN_OPENCODE_AGENT_IDS` deliberately keeps built-ins out of the
  profile table.

## Consequences

- The list drops from 43 to 37 entries; `build` is the only engine agent offered.
- Two pre-existing tests that asserted `plan` **was** listed (`issue-703-c1`,
  `opc_agent_session_routes`) were re-pinned to the new contract and strengthened
  to assert its absence.
- Adding a future engine built-in to `BUILTIN_OPENCODE_AGENT_IDS` automatically
  hides it from the picker. Making one selectable is a deliberate one-line edit to
  `SELECTABLE_BUILTIN_OPENCODE_AGENT_IDS`.
- Delegation behaviour is unchanged in practice — `plan` was already unreachable
  through all three primitives; the roster filter closes a latent path rather than
  fixing an active bug.
