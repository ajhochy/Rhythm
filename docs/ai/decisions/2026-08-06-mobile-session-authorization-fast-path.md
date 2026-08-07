---
date: 2026-08-06
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Authorize an owned mobile session from its ownership row, not a session list

## Context

Every session-scoped mobile gateway request paid a listing to answer a
single-id question. `authorizeMobileOpenCodeOperation` resolved
`projectSessionIds`, which fetched the engine's `/session` collection for the
selected project and then ran one indexed SQLite ownership lookup per returned
row, purely to test membership of the one id the request named.

The cost therefore grew with how much history a project had accumulated rather
than with the request being served — on the hot path for transcript reads,
prompt sends, and every other id-addressed operation.

Two constraints shaped the fix:

- **#1175's no-oracle contract.** A global OpenCode id must not be addressable
  before it is authorized. The contract test drives this with a permissive
  ownership repository so that project scoping is isolated, and asserts that a
  cross-project id produces *zero* upstream requests. A single-resource
  `GET /session/{id}` preflight satisfies the latency goal but violates this,
  and was abandoned for that reason.
- **The widened ownership fallbacks.** The desktop-catalog path
  (2026-07-30 owner inheritance) and the NULL-project fallback
  (2026-07-30 session visibility) must keep working exactly as they do today.

## Decision

Short-circuit authorization on an explicit `mobile_opencode_resource_owners`
row. That table is keyed on (kind, resource_id, owner_user_id, project_id), so
a hit already proves both dimensions the list filter checks: this gateway
claimed this session for this user in this project.

Everything else — desktop-catalog sessions, NULL-project sessions, and any id
with no ownership row — falls through to the unchanged `/session` path. The
fallback still decides membership by inspecting the project's own session
list and never by addressing the requested id, so the no-oracle contract holds
for exactly the ids the fast path does not already own.

The per-request `ResourceScope` is now threaded from the authorization pass
into the response-shaping pass instead of each building its own, so a
resolved collection and each per-session decision are reused across both.

## Alternatives

- **`GET /session/{sessionID}` preflight.** Rejected: it addresses the target
  id upstream before authorizing it, which is precisely what #1175 forbids.
  Measured against the contract test, it issued two requests for a
  cross-project id where the contract requires none.
- **Gate the fast path on `isResourceOwnedBy`.** Rejected: that method is
  stubbed permissively by test fixtures, so the fast path would have
  authorized cross-project ids under the #1175 harness.
  `isResourceExplicitlyOwnedBy` is optional on the reader interface and absent
  from those fixtures, so gating on it keeps the fallback in force under test
  and uses the real indexed lookup in production.
- **Drop the directory check entirely and trust ownership everywhere.**
  Rejected: it would remove the second layer for every session, not just the
  ones carrying a durable claim.

## Consequences

- A session with an explicit ownership row authorizes from one indexed local
  read and issues no engine traffic at all. Regression coverage in
  `mobile_session_authorization_cost.test.ts` asserts the only upstream request
  is the one the caller asked for; it fails on the previous implementation.
- The fast path trusts the ownership row instead of re-reading the engine's
  `directory` for that session. The row is written by this gateway when it
  claims the resource, so the two diverge only if a session's directory
  changes after the claim.
- No behavior changes for non-explicitly-owned sessions; the #1175, #1169,
  #1279 and #1285 contracts pass unmodified.

## Correction to the reported diagnosis

Two claims made while diagnosing this were wrong and are corrected here:

- The engine's `/session` is scoped by the `directory` query parameter the
  gateway already sends, so the fetch returns the selected project's sessions,
  not all ~2,241 catalog rows. The listing was still per-request and still
  O(project history); it was not O(all history).
- No single operation fetched the same collection twice. The authorization and
  shaping passes each built their own scope, but no allowed operation reaches
  both with the same collection, so sharing the scope removes redundant
  per-session decisions rather than a duplicate fetch.
