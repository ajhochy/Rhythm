---
tags: [decision, Rhythm]
---

# OCU-35B (#1177) — remote-workspace product trigger status, 2026-08-10

## Context

Issue #1177 defers the remote-workspace vertical slice behind a product trigger:
"attach a concrete workflow that local execution cannot serve, naming the
project, operator class, expected workload, data residency, and recovery
requirement. If no such workflow exists, keep the issue deferred."

This record is the required check of whether any such workflow has been
recorded anywhere in the repo docs.

## Findings — what exists

Searched `docs/` and `docs/ai/` for `NAS worker`, `remote workspace`,
`remote execution`, `remote worker`, `control-plane`, and
`OPENCODE_EXPERIMENTAL_WORKSPACES`. Every hit is the deferral machinery itself,
not a use case:

- `docs/ai/generated-issues/ocu-35b-remote-workspace-execution.md` — the issue
  text; its only workflow mention is hypothetical ("for example the managed NAS
  worker").
- `docs/ai/generated-issues/opencode-utilization/ocu-35-watch-list.md` — the
  original watch-list: workspaces "could eventually run agents on the
  NAS/server from the desktop app" — speculative, no project/operator/workload.
- `docs/ai/runs/2026-07-17-1076-watchlist-tracking-check.md` — checkpoint:
  "still experimental (workspace-routing middleware present but gated)…
  Defer — trigger not met."
- `docs/ai/runs/2026-07-28-ocu35-trigger-evaluations.md` — checkpoint: "No such
  workflow is attached to the issue and none exists in `docs/ai/` as of this
  run… keep deferred."
- `docs/ai/runs/2026-08-10-mega-pr.md` — today's triage restates the
  requirement ("requires a named concrete remote-execution use case").
- `docs/ai/current-plan-opencode-utilization.md` — "remote" hits refer to the
  org skill library (remote skill index), unrelated to remote execution.

Upstream state: the capability remains gated as experimental in the fork —
`apps/opencode_fork/packages/opencode/src/effect/runtime-flags.ts:26`
(`experimentalWorkspaces: enabledByExperimental("OPENCODE_EXPERIMENTAL_WORKSPACES")`).
`OPENCODE_EXPERIMENTAL_WORKSPACES` has not graduated.

No document names a concrete workflow with the five required attributes
(project, operator class, expected workload, data residency, recovery
requirement).

## Decision

**Product trigger NOT met.** Neither dependency holds: no concrete staff
remote-execution use case is recorded anywhere in the repo, and
`OPENCODE_EXPERIMENTAL_WORKSPACES` remains experimental upstream. #1177 stays
deferred with no implementation work scheduled.

## Alternatives

- Build the slice speculatively against the hypothetical NAS worker — rejected:
  the issue explicitly forbids implementation without a named workflow, and the
  slice carries real security surface (trust boundary, worker identity,
  tenant-scoped authorization) that should not be designed against a guess.

## Consequences

Human action (one line): **On #1177, either name a concrete staff
remote-execution workflow (project, operator class, expected workload, data
residency, recovery requirement) or reply "approve deferral" to keep the issue
deferred until one exists.**
