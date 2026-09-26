---
date: 2026-09-25
repo: Rhythm
issue: 1572
tags: [decision, rhythm]
---

# Direct-provider model visibility is policy-owned

## Context

Built-in cloud providers expose broad engine catalogs that include stale,
non-chat, preview, or account-ineligible models. Issue #1572 requires OpenAI
to expose only `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`, while
Anthropic and Gemini use their provider-specific current-model policies.

## Decision

For built-in direct providers, the provider visibility policy is authoritative.
Entries declared in `opencode.json` and `visible=1` database rows cannot extend
that allowlist; they can only be intersected with it. The visibility table may
still hide an allowed model with `visible=0`.

Custom providers remain configuration-owned: their declared models are the
allowlist. OpenRouter keeps its explicit-curation behavior.

## Alternatives

- Let built-in `opencode.json` declarations extend the direct allowlist.
- Let `visible=1` override provider policy.

Both alternatives would let stale or unsupported direct-provider models bypass
the cross-provider policy this issue introduces.

## Consequences

Adding a new built-in direct model requires an intentional policy change and
test update. A user declaration alone cannot make that model picker-visible.
Custom and local provider declarations remain directly configurable.
