---
date: 2026-10-08
tags: [decision, rhythm, dayflow, scheduler]
---

# Ownerless/projectless sessions are Dayflow non-receivers, not ambiguous history

## Context

From the 2026-10-07 build, every AgentRunner session without an owner or project
(scheduled roots and children, self-improvement runs) failed before the provider ran
with `Dayflow provider guard held this request (history_ambiguous)`. 62 sessions in the
first day: 11 scheduled roots, 51 self-improvement. All schedules on the instance have
no creating user, so there is no real owner to attach. `lookupProviderSession` reported
any missing owner/project as `ambiguous`, and admission held before checking whether
any Dayflow evidence existed. A session can only receive Dayflow (tool reads or the
provider overlay) with a valid owner AND project, so such a row is structurally a
non-receiver.

## Decision

Mega (`ac056260`, from the #1610 line) already admits ownerless scheduled ROOT sessions on
a zero-history path. This branch widens that same path instead of adding a second one:

- A single well-formed row missing owner and/or project is `unbound` when it is either a
  system AgentRunner session (`is_system=1`, category `scheduled` or `self_improvement`,
  root or child; owner optional) or an OWNED interactive chat left unassigned to a project
  (the app allows explicit "unassigned"; 34 of 344 chats in the week before the deploy).
  It must also be unarchived, unmarked, carry a well-formed scheduled task id when present
  (none for interactive chats) and have no retained Dayflow evidence (any
  `dayflow_context_*` dispatch column). It is admitted as ordinary only if any known owner
  matches the caller; the decision is re-checked at final exposure.
- Ownerless interactive rows, other-category rows, marked rows and rows carrying evidence
  stay `ambiguous` -> `history_ambiguous` (corrupt; never cleared or repaired here). A known foreign owner holds `receiver_changed`. Malformed values, a null id and
  duplicate rows stay `ambiguous`. Owned sessions keep the existing `found` path.
- The Coordinator workflow path does not admit unbound rows.
- No projects or owners are invented; production rows are not patched.
- AgentRunner keeps the exact guard reason in run and scheduler diagnostics.
- AgentRunner memory uses the interactive generic Dayflow fence, so Dayflow-tagged
  memories are omitted from scheduled runs rather than blocking them.

## Alternatives

- Scheduled roots only (#1610 line, now on mega): leaves scheduled children and the
  self-improvement runs held (61 of 72 failures since the 2026-10-07 build).
- Any well-formed ownerless row (this branch's first draft): also admits interactive rows
  that lost their binding; holding those is the safer default.
- Clear or backfill markers/owners in production: hides the problem and invents
  authority.
- Remove the provider guard for Rhythm-managed calls: drops the protection for real
  receivers.

## Consequences

Unattended runs execute again unless they actually carry Dayflow evidence. A run that
does is still held, now with its real reason in the scheduled-run history. Separate
failures (for example an unavailable MCP server) are unaffected.
