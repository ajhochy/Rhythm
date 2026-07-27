---
date: 2026-07-26
repo: Rhythm
status: accepted
tags: [decision, Rhythm]
---

# Memory source resource scheme

## Context

OKF memory notes can attribute individual claims to `sources` entries. Those
entries need stable identifiers for markdown footnotes and stable resource
URIs that remain meaningful outside a single process or database.

## Decision

- Agent sessions use `rhythm://agent-session/<percent-encoded-session-id>`.
- Rhythm tasks use `rhythm://task/<percent-encoded-task-id>`.
- External web and email material keeps its native `https:` or `mailto:` URI.
- Automatic session-source footnote ids use `sess-<session-id>` when the id is
  footnote-safe (`A-Za-z0-9_-`). Other characters are normalized to hyphens,
  with base64url as the empty-result fallback.
- `sources[].id` is note-local. The `resource` URI is the durable global
  identity; source ids exist to connect prose markers such as `[^sess-01J8X]`
  to frontmatter entries.
- Source credibility fields are recorded as supplied. Rhythm does not compute
  a credibility score.

## Alternatives

- Reusing `agent_session_memory_provenance` was rejected because it records
  which memories a session read, not where a memory claim originated.
- Database row ids were rejected as resource identifiers because the local
  memory index is disposable and rebuildable.
- Plain unqualified session ids were rejected because they are ambiguous when
  notes are exported or combined with external sources.

## Consequences

Attribution survives index rebuilds and note export, while markdown footnotes
remain compact. Consumers must tolerate dangling footnotes and unavailable
resources; validation reports those conditions without rewriting the note.
