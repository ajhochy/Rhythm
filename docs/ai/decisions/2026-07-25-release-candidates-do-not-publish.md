---
date: 2026-07-25
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Signed release candidates do not publish by default

## Context

The desktop release workflow previously coupled signing/notarization to an
unconditional GitHub release. That made it impossible to prove the packaged app
under clean-user conditions without also publishing it. Missing Apple secrets
also caused the signing script to exit successfully, allowing an unsigned build
to proceed as if it were a release candidate.

## Decision

Desktop workflow dispatches now build a nonpublishing candidate by default.
They fail before the build if any required Apple credential name is absent,
verify the signed and notarized app and DMG, and run the mounted-DMG clean-user
behavioral smoke. Publishing requires the explicit `publish_release=true`
workflow input.

## Alternatives considered

- Keep publishing every workflow run and delete unwanted releases afterward.
  Rejected because publication is externally visible and deletion is not a
  reliable validation workflow.
- Let signing continue to skip when credentials are missing. Rejected because
  an unsigned artifact cannot satisfy the release acceptance criteria.
- Treat the earlier Debug-app smoke as equivalent. Rejected because it did not
  exercise the packaged, Developer-ID-signed, notarized artifact.

## Consequences

The same workflow can now produce a merge-review candidate without creating a
GitHub release. Missing credentials, invalid signatures, missing tickets,
Gatekeeper rejection, packaged-app startup failure, Engraph leakage, or broken
FTS fallback all stop the job before publication.
