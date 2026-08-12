---
date: 2026-08-11
tags: [decision, Rhythm]
issues: [1378, 1379]
---

# Mobile mirror reads are authoritative only when complete; everything else falls through live

## Context

The phone live-proxied every read to the OpenCode engine on `:4096`, so opening
a session blocked on engine liveness — a cold Tailscale connection or a Mac
mid-turn produced the ~40s / three-attempt first open reported in #1379. The
desktop never had that problem because it reads api_server's SQLite mirror,
which the consolidated `/global/event` ingest keeps current for desktop-driven
and background turns too.

Flipping the phone's reads onto that mirror is mostly wiring — the mirror
already exists, and `listOwnerUnscopedMobileChats` already proves a mirror-served
read can be returned behind an engine-shaped operationId with no fingerprint
bump. The real design question is **when the mirror is allowed to answer**, and
what happens when it cannot.

Two facts constrain the answer:

1. For a list, a cache miss is unobservable. An empty result is a legitimate
   answer and is indistinguishable from "the ingest has never seen this project".
2. The mirror does not store everything. Before this change it recorded message
   `role`/`tokens`/`cost`/`parts` but not the engine's full `message.info`, so
   `error`, `summary`, and `time.completed` — all of which the phone renders —
   had no home. The bridge also mirrors child session *rows* but not child
   message *parts*.

## Decision

**The mirror answers only when it can answer completely and faithfully. Every
ambiguity falls through to the unchanged live engine path.**

Concretely:

- Add `agent_session_messages.info_json` and store the engine's `message.info`
  verbatim. Serve it back unchanged rather than reconstructing an `info` from
  the columns that happen to exist. A reconstruction would have been lossy in
  exactly the fields that matter on a failed turn.
- A transcript page is served only when **every** row in the window carries
  `info_json`. Legacy rows, unparseable rows, or a cursor the mirror does not
  hold all fall through live.
- A session list is served only when the mirror holds at least one chat row for
  that (owner, project). An exact-session lookup that misses always falls
  through, so #1379's exact-session pinning cannot false-negative.
- Children are served when the *parent* is a mirror row the caller owns; then an
  empty child list is authoritative.
- Mirror reads are an explicit three-operation allowlist
  (`experimental.session.list`, `session.children`, `session.messages`).
  Everything else is live by default.

## Alternatives considered

**Synthesize `info` from the existing columns.** Smaller diff, no migration. A
turn that failed would have rendered with no error and a summarization message
would have lost its `summary` marker — a silent, hard-to-attribute display bug
in the exact situation where the user most needs to see what happened. Rejected:
the migration is one additive nullable column and buys exactness.

**Treat the mirror as unconditionally authoritative.** Fastest, simplest branch
logic. But a session created out-of-band would never appear until something else
wrote it through, and a child transcript would render as convincingly empty
rather than as unavailable. Rejected — "wrong but fast" is the failure mode this
plan exists to remove, not to relocate.

**Backfill `info_json` for existing rows.** Nothing to backfill from: the engine
`info` for a historical message was never persisted anywhere. Existing sessions
therefore keep serving transcripts live until new messages arrive, and converge
naturally. Accepted as a consequence rather than solved.

**Also mirror plain `session.list`.** Its archived-inclusion semantics are not
pinned by anything the mirror schema records. Guessing them risks a silent
behavior mismatch, and the phone's first paint does not depend on it. Left live.

**Add a mobile-native contract version to the handshake.** Not needed here —
every mirror read is served behind an existing engine-shaped operationId, so it
sits inside the already-fingerprinted surface. The handshake's three pinned
fields are exact-equality gated, so touching them is only worth doing when a
genuinely new native DTO ships.

## Consequences

- Session browsing, the archived list, and transcript paging no longer contact
  the engine on a mirror hit — pinned by test, with a fetch stub that fails the
  test if the engine is touched.
- `contractFingerprint` does not move. No paired phone re-pairs.
- Sessions that predate `info_json` keep serving transcripts live and converge
  as new messages arrive. Acceptable and self-healing.
- Child transcripts stay live until the bridge mirrors child message parts
  (plan Phase 3). The completeness check makes this correct-by-default rather
  than something to remember.
- The fall-through branches are load-bearing, not incidental. Six of them have
  dedicated tests, because a mirror that silently serves a partial answer is
  worse than the slow path this change replaces.
