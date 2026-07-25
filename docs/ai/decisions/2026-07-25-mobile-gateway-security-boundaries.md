---
date: 2026-07-25
repo: Rhythm
branch: codex/1175-security-correctives
status: accepted
tags: [decision, Rhythm]
---

# Mobile gateway ownership and human authorization boundaries

## Context

Project-directory scoping alone allowed two paired users of the same Rhythm
project to address each other's global OpenCode session and PTY identifiers.
The ordinary bearer credential also reached operations that must remain
desktop-human-only. Google login paths could persist a new verified identity
without a single shared account-admission decision.

## Decision

Persist every mobile-created OpenCode session and PTY with an owner user and
project. Desktop-created sessions may use the existing `agent_sessions`
mapping; legacy rows with no owner/project fail closed. Lists are filtered and
every direct HTTP, SSE, PTY-token, and WebSocket path revalidates the same
mapping.

Pairing-code creation, Tailscale access administration, and desktop device
administration require a raw capability held in the signed desktop app's
Keychain. The child API receives only its digest through configuration. Device
credentials may revoke exactly themselves and nothing else.

All Google ID-token and exchange paths call one admission service before any
upsert or session creation. Admission requires an existing/preprovisioned
identity, an explicitly configured email, or a verified Google `hd` claim that
matches both the email suffix and a configured hosted domain. The policy is
fail closed in development and production.

## Alternatives

- Project-only isolation was rejected because OpenCode IDs are global within
  the engine.
- In-memory ownership was rejected because restarts would turn valid resources
  into legacy ambiguity or re-open cross-user access.
- Bearer plus model-side confirmation was rejected because the model holds the
  bearer credential.
- Email-suffix-only Google admission was rejected because an email string is
  not a verified Workspace hosted-domain claim.

## Consequences

- Mobile-created resource IDs are durable and non-transferable between users.
- Unmapped legacy resources are invisible to mobile clients until a durable
  owner exists.
- Bearer compromise does not grant desktop administration; paired devices
  retain a narrow recovery path through self-revocation.
- New Google accounts require explicit configuration or verified Workspace
  membership before any database mutation.
- The ownership table is additive in SQLite and the Postgres bootstrap path.
