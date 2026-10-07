---
date: 2026-10-04
tags: [decision, rhythm]
---

# Org Reviewer target state uses bounded, verified pages

## Context

`OrgReviewerService.context` preserves a 44,000-byte context response. A
target's complete canonical state can exceed that response on its own, which
previously returned 409 even though the reviewer needs the complete state to
validate a proposal. Queue paging already exists and is not part of this
change.

The target can include managed skill content and the live capability catalog.
It is both completeness-critical and untrusted external-style content. Releasing
individual fragments without first scanning the whole canonical target would
allow an injection pattern split at a page boundary to escape detection.

## Decision

- Keep the existing small target-specific response shape: it returns complete
  `currentState` with the existing exact target receipt fields.
- When that result cannot fit, return a page-only target response with
  `currentStatePage` rather than mislabeling a fragment as `currentState`. The
  page has canonical-JSON `text`, `offset`, `totalChars`, `textComplete`, and
  `nextCursor`; its root retains the exact `targetRef`, `targetRevision`,
  `targetStateHash`, `windowDays`, and `sessionLimit` receipts. Page mode omits
  redundant overview/index/catalog collections.
- Use a bounded versioned stateless cursor that binds target reference, owner,
  effective window and session parameters, revision, complete-state hash, and
  offset. Every continuation re-resolves the target and rejects malformed,
  cross-owner/target/window, stale revision/hash, out-of-range, and surrogate
  splitting offsets. The cursor is not authorization: the signed tool
  arguments and per-call owner authorization remain mandatory.
- Generate pages below 40,000 compact UTF-8 bytes, accounting for JSON
  escaping and worst-case cursor size. The MCP layer continues to fence output
  below 50 KiB. A page cannot be produced if no Unicode-safe bounded fragment
  is usable.
- Before every initial or continuation fragment, scan both the legacy
  insertion-order `JSON.stringify(target.state)` representation and the
  canonical representation emitted across pages. Key sorting can otherwise
  separate a cross-field pattern that the legacy complete-target boundary
  catches. Scanner logs remain metadata-only. The MCP also sends each emitted
  page fragment through the existing scan/taint-boundary routine with
  `trustedSecurityContext`, fences it as untrusted content, and rejects a
  response that attempts to contain both `currentState` and
  `currentStatePage`. The API and MCP injection pattern lists were compared
  for equivalence; their only difference is explanatory header text.
- Add only the frozen R13 owned-skill identity hash
  `ad2049e2a2f136553d47a0198db52ffeffe97bb81993cade2029f475cf22d3b7` to the
  adoption allowlist. This is the existing SHA-256 of the skill description,
  newline, and trimmed body—not a broad file replacement rule. An exact known
  prior asset can adopt the new cursor-loop instructions; edited or deleted
  skills retain the existing fail-closed behavior. `REVIEW_PROMPT` is
  intentionally unchanged: this does not force a prompt migration, and
  existing seed prompt migration behavior is preserved.

## Alternatives

- Raise the 44,000-byte context budget: rejected because the engine/MCP output
  limits remain fixed.
- Return a prefix under `currentState`: rejected because it would falsely imply
  complete state validation.
- Store cursor state in a table or add a new endpoint/grant: rejected as
  unnecessary durable surface area for a target that can be re-resolved and
  receipt-checked on each call.
- Scan only emitted fragments: rejected because hostile text can cross a page
  boundary.

## Consequences

Review agents must concatenate pages only at the declared offsets, require
stable receipts, and `JSON.parse` the text only after `nextCursor` is null.
They must not propose from incomplete, withheld, stale, or receipt-mismatched
state. This is a caller/skill obligation; the unchanged stateless submit API
continues to validate exact receipts and checks but does not track whether a
caller consumed every page. Queue pages remain the already-supported mechanism.

Paging does not remove the existing semantic limits: profile `boundSkills`
retain their `bodyTruncated` and `bodyHash` metadata, and catalog omission /
truncation metadata remains visible in the appropriate overview or catalog
read.

Focused synthetic coverage validates reassembly, receipts, Unicode/escaping,
all page/fence bounds, cursor rejection, state changes without a profile
revision change, and cross-boundary hostile-content rejection. Normal-app
integration and any live sandbox check remain pending by explicit task scope.
