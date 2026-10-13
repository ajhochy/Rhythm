---
date: 2026-10-12
repo: Rhythm
tags: [decision, Rhythm, security, hermes, approvals]
---

# Owner-authenticated Hermes relay decisions are not desktop signatures

## Context

AJ explicitly authorized approving/rejecting exact pending Rhythm cards from Hermes chat with the existing protected Rhythm API token, without a second login/presence challenge. Existing desktop decisions use a distinct capability plus P-256 signature; engine actions use ephemeral engine-signed tool proofs. Those boundaries must not be conflated. Agent approval state is local SQLite execution state, not hosted Postgres user data.

## Decision

Add three owner-authenticated tools (`rhythm_list_pending_approvals`, `rhythm_get_pending_approval`, `rhythm_decide_approval`) and a separate `/agent-approvals/relay` HTTP surface. Existing local-or-cloud bearer resolution authenticates the user; the session's non-null exact `owner_user_id` authorizes access. No admin override, owner guessing, caller-supplied identity, profile permission changes, or local-mode auth bypass. Unowned legacy cards stay invisible. Use the existing protected token file/operator wrapper to inject the already-supported `RHYTHM_API_TOKEN`; no new authentication mechanism.

The explicit per-card decision includes opaque pending revision and SHA-256 card hash plus `owner_chose_in_chat`. Server-authored audit records the actual authenticated owner name/ID, display identity `AJ via Hermes` (or actual owner), source `hermes`, decision and assurance **relay-attested**. The token holder attests the owner chose in chat. Rhythm **cannot independently prove** a chat click; this is NOT a cryptographic human signature. Anyone possessing the token can make this attestation. That deliberate security tradeoff is approved for this feature only.

Revision derives from card ID and pending one-time nonce. Hash binds revision, owner, all displayed fields and all executable bindings. An SQLite IMMEDIATE transaction rereads owner, freshness, revision/hash, then consumes the existing pending decision nonce exactly once. Existing actor string stores a versioned JSON receipt; no new table or migration. Reject replays rather than return idempotent success. A lost success response is ambiguous to the client, not authority to decide again.

Reuse existing durable continuation after committing a decision. Before consuming a relay-approved card, additionally compare its current fields/owner against the saved receipt hash. Never replace the existing engine proof, session/agent/profile/current-taint, exact outbound action/payload, expiry and atomic single-consumption guards. Desktop signing/capability code stays unchanged. Generic cards without expiry are relay-decidable only within ten minutes of creation; security-bound expiry/taint remain original. Malformed expiry fails closed on relay reads/decisions.

## Alternatives

- Desktop signature impersonation: rejected; falsely claims human-presence assurance and exposes distinct desktop authority.
- Second password/passkey/login: rejected by the approved contract.
- Blanket/role-wide approvals or admin/global cards: rejected; owner/exact-card choices only.
- New approval tables/token/password infrastructure: rejected; existing nonce/actor/continuation machinery suffices.
- Relaxing engine/taint/session guards for external execution: rejected; relaying a decision is not executing an engine action.

## Consequences

- Token compromise/agent misuse can manufacture chat consent. Tool descriptions and integration instructions are NOT independent proof of consent. Keep token material protected and never place it in prompts, logs or process arguments.
- Fixed source `hermes` describes the relay attestation protocol; the server does not cryptographically identify the Hermes process either.
- Sessionless/unowned legacy approvals require a new owner-backed request. Existing cloud resolver has a five-minute identity cache; this feature does not change revocation semantics.
- Deployment must update API and MCP together. No hosted migration/network/relay routing/container restart is part of this work. Old consumers lack the additive relay hash check: outstanding relay-approved cards need human review before rollback execution.
- Successful single consumption is not exactly-once downstream effect delivery. Failure after consumption does not restore authority; automatic retries are not introduced.
- Evidence: [run](../runs/2026-10-12-hermes-authenticated-approvals.md), [operator/developer guide](../guides/hermes-authenticated-approvals.md). Real external SDK/stdio transport and fork-signed synthetic task gate passed; actual Hermes chat UX and packaged Keychain remain human-owned smoke, not claimed here.
