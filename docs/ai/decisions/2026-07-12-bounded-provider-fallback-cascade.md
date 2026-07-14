---
date: 2026-07-12
repo: Rhythm
tags: [decision, Rhythm, fallback]
---

# Bounded provider fallback cascade lives with retained turn state

## Context

Anthropic account exhaustion had an early plugin POST, while OpenAI, Google,
and OpenRouter failures converged later as structured engine `session.error`
events. The previous redispatch state was one-shot and did not retain enough
identity to advance more than once or prepare a new provider's tool surface.

## Decision

Keep transient cascade state beside the retained composed turn in
`turn_redispatch.ts`: current tier/provider/model, phase, deferred error, and a
visited-tier set. Both the Anthropic-compatible spillover route and the shared
stream bridge call one `advanceFallbackCascade` transition. Classify the raw
structured engine error centrally in `model_fallback.ts`; only rate-limit or
quota-exhaustion errors advance. Mark a destination visited before prompting,
and reapply the session MCP allowlist with the destination provider before
every redispatch so Google receives the Gemini cap/deferred surface.

## Alternatives

- Add provider-specific POST callbacks/plugins for OpenAI, Google, and
  OpenRouter. Rejected: the engine already normalizes their terminal errors to
  one structured SSE event, so this would duplicate transport-specific logic.
- Persist visited tiers in SQLite. Rejected: the state is meaningful only for
  one in-flight composed turn and matches the existing in-memory session map.
- Cascade from `session.status.retry`. Rejected: that event preserves only a
  display message and fires for retryable 5xx errors too; terminal
  `session.error` retains status/body/code and avoids false fallback.

## Consequences

- A rate-limited replacement tier can advance again; non-rate-limit errors
  preserve normal finalization.
- Every configured tier is attempted at most once per retained turn, with
  OpenRouter-free terminal.
- Non-Anthropic fallback waits for the engine's bounded three retry attempts.
- Process restart loses only the transient in-flight cascade, matching the
  existing retained-turn and SDK-session-map posture.
