---
date: 2026-09-24
tags: [decision, Rhythm]
issues: [1178]
---

# Detached transcript shares use the approved 90-day expiry

## Context

AJ's [August 11 D2 approval](https://github.com/ajhochy/Rhythm/issues/1178)
sets the transcript-sharing default expiry to 90 days. The source-bound share
repository already used that value, but the detached `POST /shares` path and
the September 11 cross-server ADR still defaulted to and capped expiry at 30
days.

## Decision

Detached shares use `SharedTranscriptsRepository.defaultExpirationMs` for both
their default expiry and maximum accepted expiry. The current value is 90 days;
an explicit timestamp after that cap fails closed with a 90-day validation
message.

This decision supersedes only the 30-day expiry statements in
`2026-09-11-cross-server-transcript-sharing.md`. Its detached snapshot,
sanitization, authorization, provenance, audit, revocation, and source-deletion
decisions remain unchanged.

## Consequences

Source-bound and detached publication now apply the same approved retention
window. The separate 30-day post-expiry or post-revocation purge retention is
unchanged. Desktop expiry copy and choices must use the same 90-day cap.
