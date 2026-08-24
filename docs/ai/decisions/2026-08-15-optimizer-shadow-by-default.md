---
date: 2026-08-15
repo: Rhythm
tags: [decision, Rhythm]
---

# The org optimizer defaults to shadow mode

## Context

The self-optimizer generates proposals to change agent profiles — their
permissions, their prompts, their scope — and before this campaign it could
apply some of them automatically. A live audit found 69 proposals carrying
legacy whole-field scope snapshots, and the apply/revert lanes had no
compare-and-set, so a rollback could silently overwrite a permission change a
human had made in the meantime.

The engine's whole purpose is to change itself. That makes its default mode a
safety decision, not a configuration preference: whatever the default is, that
is what runs on every machine where nobody has opted into anything.

Four modes exist: `off`, `shadow`, `human_only`, `auto`.

## Decision

**The default is `shadow`.** The parser accepts only those four values, and
every other input — absent, empty, misspelled, wrong-case, hostile — resolves
to `shadow`, never to `auto`.

In shadow the optimizer still audits, generates and ranks proposals, and still
reports counters that identify what it *would* have done. It calls no apply, no
measure, no revert, no install, and no target writer. Observable state is
byte-identical after a shadow run: every `agent_configs` scope string, every
`agent_org_proposals` status and revision, and every projected profile file on
disk. That is asserted as a full before/after comparison, not by spying that a
function was not called.

The gate lives in the optimizer's run loop, never inside `applyProposal` /
`measureProposal` / `revertProposal`. Those are shared with the human-approved
route, which must keep working under every mode — a human who clicks approve is
not the thing this default is protecting against.

**One deliberate exception.** W1 added a bounded recovery sweep that repairs
lagging profile projections and durably marks incoherent claims, and
`runOrgOptimizer` is its only production caller. A naive shadow gate would make
that repair path dead code on every default install. Two acceptance statements
had to hold at once — "shadow has zero mutation side effects" and "lifecycle
drift is reportable with a default-dry-run reconciler". So in shadow the sweep
runs **report-only**: it classifies and counts lagging projections and
incoherent claims and writes nothing. It acts in `human_only` and `auto`, where
an operator has opted in.

## Alternatives

**Default to `off`.** Safest in the narrowest sense, and rejected: it produces
no proposals, so nobody ever sees what the optimizer would do, and the feature
is evaluated on zero evidence. Shadow gives the same zero-mutation guarantee
while still generating the evidence needed to decide whether to enable more.

**Default to `human_only`.** Rejected as the *default*. It is the right mode to
graduate to, but it presumes someone is watching the approval queue. On a
machine where nobody opted in, nobody is.

**Keep auto-apply for low-risk kinds.** This was the prior behaviour and it is
what the audit found wanting. "Low risk" was a classification the same system
computed about its own proposals; a self-improvement engine that decides which
of its own changes are safe enough to apply unattended is exactly the loop this
campaign exists to interrupt.

**Disable the recovery sweep under shadow.** Rejected for the reason above: it
would satisfy the letter of "zero mutation" by making a safety repair
unreachable by default, which is a worse outcome than the mutation it avoids.

## Consequences

- A default install generates proposals and changes nothing. Enabling anything
  is an explicit act.
- Shadow-by-default broke no existing test, which sounds reassuring and is not:
  it means the pre-existing suite barely exercised the auto-apply path. That
  was verified rather than assumed during review.
- Kill switches per change family are independent of the mode, and a disabled
  family is refused at generation/auto-apply time regardless. A human-approved
  apply or revert is deliberately NOT affected by a kill switch.
- The counters must distinguish "a shadow candidate existed" from "no candidate
  existed", or shadow mode reports the same thing whether the engine is working
  or broken.
- Graduating to `human_only` or `auto` re-enables the acting form of the
  recovery sweep. Anyone making that change should know they are enabling two
  things, not one.
