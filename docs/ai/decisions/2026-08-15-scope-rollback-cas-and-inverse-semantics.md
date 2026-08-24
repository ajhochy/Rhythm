---
date: 2026-08-15
repo: Rhythm
tags: [decision, Rhythm]
---

# Scope rollback is compare-and-set with inverse semantics, and refuses what it cannot prove

## Context

A scope proposal changes an agent profile's permissions — which MCP servers and
skills it may reach. Reverting one is the dangerous direction: it writes
permissions back, and the state it is writing back to may no longer exist.

Two shipped behaviours made that unsafe.

**Legacy snapshots.** 69 live proposals stored a whole-field snapshot — the
entire allowlist as it stood at apply time. Reverting one wrote that whole field
back, so any permission a human granted afterwards was silently erased. The
snapshot could not distinguish "this proposal added X" from "the field was this
whole value", so it could not undo its own change without undoing everyone
else's.

**No compare-and-set.** The revert lane read a row, computed a new value, and
wrote it. Anything that changed in between was overwritten. Worse, the caller
held the row across an await and passed that stale copy to the file writer, so a
revert could project a *wider* scope to disk than the database ever contained.

## Decision

**Revision is the lifecycle CAS token.** Every `agent_configs` and
`agent_org_proposals` row carries a `revision` that is monotonic and
forward-only, enforced by database triggers in both engines: a BEFORE UPDATE
guard rejects any write where `NEW.revision <= OLD.revision`, and an AFTER
UPDATE trigger auto-bumps when a writer did not set it. Monotonicity is the
point — a raw rollback that reused an earlier number would revive a stale token
and reintroduce the ABA problem the token exists to prevent.

**Rollback is inverse, not restorative.** Canonical v2 snapshots record the
delta — what this proposal added or removed — plus the exact prior and expected
post-apply values of the one field it touched. A revert applies the inverse of
its own change and verifies the field still holds the exact bytes it applied. It
never writes a remembered whole field.

**Legacy snapshots are refused, not best-effort reverted.** A proposal whose
snapshot cannot be proven to describe the current state fails closed with a 409
and changes nothing. A rollback that cannot prove what it is undoing is not a
rollback.

**The projection boundary owns the file.** Callers state an intent — a profile
id and the revision they believe they are projecting — and the boundary re-reads
the latest row itself. No caller passes a config row to the renderer. This is
enforced on the IMPORT, not the call: a module that never imports the renderer
cannot call it by any name. An evasion table (alias import, namespace alias,
dynamic import with rename, require, re-export hop, barrel re-export, computed
specifier) pins the guard, because a first version matched the call token and
five of eight evasions walked straight through it.

**Detection is durable where atomicity is impossible.** The database commit, the
profile file, and the engine reload are three stores that cannot commit
together. Rather than pretend otherwise, the lifecycle guarantees durable
DETECTION: a bounded recovery sweep re-projects profiles whose file lags the
row, and classifies stranded claims. Anything it cannot resolve becomes
`reconciliation-required` — durable, and terminal for automation. There is no
durable `applying` state; a status that means "maybe half-done" is a status
nobody can act on.

## Alternatives

**Migrate the 69 legacy snapshots to v2.** Rejected: the information needed to
build a delta was never recorded. Reconstructing it would mean guessing which
part of a whole-field value this proposal was responsible for, and a wrong guess
silently removes a permission.

**Last-write-wins on revert.** Rejected — that is the shipped bug.

**Row-level locking instead of CAS.** Rejected: the write spans a database
transaction, a file write and an engine reload. A lock held across all three
either serialises the engine or gets dropped at the boundary that matters.

**Restore the whole field but merge in anything newer.** Rejected: "anything
newer" is not knowable from a whole-field snapshot, which is the same
information gap in a different shape.

## Consequences

- Reverting a legacy proposal is impossible by design. Those 69 rows are
  reported by the read-only reconciler, classified `unsafe-legacy-rollback`, and
  left for a human. That is the intended end state, not a gap.
- Any write to `agent_org_proposals` advances the CAS token, including a
  bookkeeping write. Non-domain facts therefore live in their own tables — this
  is why the retirement sidecar and the experiment record are separate tables
  rather than columns.
- A concurrent edit makes a revert fail with `conflict`, not succeed partially.
  Callers must handle three distinct 409-shaped outcomes and must not fold them
  together: `unsafe-legacy-scope` and `conflict` both mean nothing happened,
  while `reconciliation-required` means the transaction may have committed and a
  human must inspect the pair. The third is the one an operator most needs to
  see.
- The recovery sweep is bounded — a per-run limit, an attempt count, and a
  backoff — because an unbounded reconciler that retries a permanently broken
  row is a busy loop that hides the breakage.
- An `approved` proposal whose target has moved is NOT resumed. The human
  approved an exact preimage; if that preimage is gone, their approval no longer
  describes anything and needs to be given again.
