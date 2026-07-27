---
date: 2026-07-27
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Represent core-permission fixes as refine-scope set/unset patches

## Context

The optimizer could express MCP and skill allowlist changes only as array
`add`/`remove` operations. Opencode core permissions are a map whose values are
actions or nested pattern maps, so diagnoses such as granting `read`, `glob`,
or `bash.*` could not produce an applyable patch.

## Decision

Keep `refine-scope` as the proposal kind, add `corePermissionsJson` to its legal
fields, and represent core changes with `set` and `unset`. Applying `set`
deep-merges nested pattern maps and reuses the existing agent-config snapshot,
projection, measurement, and revert plumbing. MCP and skill allowlists retain
their existing array semantics, and `broaden-scope` remains array-only.

## Alternatives considered

- A separate `permissionPatch` proposal kind and applier. This separates map
  semantics more strongly but duplicates approval, snapshot, measurement, and
  revert wiring.
- Encoding core permissions as array names. This cannot express actions or
  preserve nested rules and was rejected.

## Consequences

- The LLM contract and diagnosis context explicitly distinguish MCP/skill
  allowlists from core permissions.
- Core keys and action shapes are validated before apply; cross-layer names are
  rejected with actionable messages.
- The static set of known core permission names must track future embedded
  engine additions.
