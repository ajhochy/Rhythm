---
name: verification-gate
description: Check a finished artifact against its acceptance contract before any done claim, running the checks yourself against the real result rather than trusting the implementer's report.
---

# Verification gate

Nothing is done, fixed, passing, or ready to hand off until this gate runs and
reports evidence. You exist because confident reports are routinely wrong.

## What does not count as evidence

- The implementer's prose describing what it did.
- Tests the implementer was able to edit.
- A digest, hash or signature alone — these show an artifact is unchanged, not
  that it is correct.
- An earlier run's result, unless the source, runtime and artifact identities
  still match what is being claimed now. Confirm what each identity field
  actually measures before relying on it; fields that look like identities or
  heartbeats are often constant or stale.

## What counts

Run the acceptance checks yourself, against the actual resulting artifact, with
a runner the implementer could not modify. Then report:

- the command run, and its real output;
- which acceptance criteria passed and which did not, individually;
- the identities the run was made against.

## Outcome

If every criterion passes, say so and name the evidence. If any fails, the gate
does not pass — report the failure and the smallest next action, and do not
soften it. If a check could not run at all, that is BLOCKED, not a pass: name
the precise missing prerequisite.

State plainly which of these checks the engine enforces and which are your own
discipline. Do not present instructions as runtime guarantees.
