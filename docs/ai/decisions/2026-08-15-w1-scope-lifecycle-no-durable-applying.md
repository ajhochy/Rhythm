---
date: 2026-08-15
tags: [decision, Rhythm]
---

# W1 scope lifecycle: no durable `applying`, and one projection boundary

## Context

A human approves a scope proposal that mutates an agent profile's allowlists or
core permissions. Three stores must end up agreeing: the `agent_org_proposals`
row, the `agent_configs` target row, and the profile markdown file the OpenCode
engine loads. They cannot be committed together.

The corrective-5 shape claimed `proposed -> applied` first and then ran a
callback that mutated the target. That claim could not be fenced on the target
revision, so a concurrent operator edit between the claim and the callback was
invisible, and a failed callback left a durable `applied` row whose target was
never written.

A durable `applying` status was proposed to cover the window.

## Decision

1. **No durable `applying`.** The lifecycle is
   `proposed|failed -> approved -> applied -> measuring -> active|reverted`.
   `approved` means the human claim is durable and the target is untouched;
   `applied` means both rows moved in one transaction and projection is pending;
   `measuring` means the committed revision was projected. An `applying` row
   would be an activity flag, not ownership — it prevents no duplicate worker
   that the proposal/target revision CAS pair does not already prevent, and it
   adds one more crash-stuck state to recover from.
2. **`approved -> applied` and the `applied -> approved` compensation are
   atomic-only.** Any other arrival at `applied` on a scope kind is refused by
   the repository, including `proposed -> applied` and `failed -> applied`.
3. **One projection boundary that takes an ID and a revision, never a row.** A
   caller holding a config row it read before an await has a possibly stale copy;
   writing it would silently overwrite a newer operator edit. The boundary
   re-reads the latest row and projects THAT, with no await between the read and
   the file replace.
4. **Indeterminate means reconciliation-required, never blind compensation.** An
   atomic transaction that throws is classified by reading both rows back —
   preimage means it rolled back, postimage means it committed, anything else is
   genuinely unknowable. Restoring prior bytes without that proof would destroy a
   concurrent operator's write.

## Alternatives

- **Durable `applying`.** Rejected: see above. It also widens the window in which
  a crash leaves a row no sweep can classify.
- **Keep the callback seam and add a revision check inside it.** Rejected: the
  check and the write would still be two statements against two stores, and the
  claim itself would still be unfenced.
- **Claim cross-store atomicity via temp-file + rename.** Rejected as dishonest.
  Same-directory rename gives visibility semantics on the supported local
  filesystem; it is not atomic with the database, not a guarantee across power
  loss, and not proof the engine reloaded the bytes.

## Consequences

- The safe guarantee is durable DETECTION and reconciliation, not cross-store
  atomicity. That must be stated wherever the flow is documented.
- The deployment contract narrows: exactly one local profile-projection owner
  process. Two processes sharing one HOME cannot be fenced by a revision read
  alone; that needs a kernel lock or an owner daemon plus outbox.
- Existing service and controller tests that drove the old callback shape had to
  be rewritten against the production lifecycle. Test fixtures that need a
  durable `applied` row now use a named raw-SQL helper, so the refusal cannot be
  accidentally re-asserted as permitted.
- `reconciliation-required` needs to become a durable status with its own
  columns, propagated through measurement, the optimizer summary and the routes;
  until it is, an unresolved operation is only visible as an HTTP 409 and a log
  line.
