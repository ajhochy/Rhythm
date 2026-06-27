---
date: 2026-06-25
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# #743 — Used `logger.info` instead of `logger.debug` for soft-404 and orphan-skip logs

## Context

The getDiff soft-404 fix and the child-session orphan-skip path both warranted low-priority log output (not an error, just diagnostic). The natural choice was `logger.debug()`, but `tsc --noEmit` failed with:

```
error TS2339: Property 'debug' does not exist on type
  '{ info(...): void; warn(...): void; error(...): void; }'
```

The `logger` utility in `apps/api_server/src/utils/logger.ts` only exposes `info`, `warn`, and `error` — no `debug` level.

## Decision

Use `logger.info` for both messages. The messages are prefixed with `[AgentSessionsController]` and `[OpencodeStreamBridge]` so they're filterable in log output.

## Alternatives considered

1. **Add `debug` to the logger utility** — out of scope for this issue; would require touching unrelated infrastructure.
2. **Use `console.debug`** — inconsistent with existing log style; would bypass any log-level filtering the logger provides.
3. **Remove the log entirely** — loses the diagnostic signal that was useful for the flood investigation.

## Consequences

The soft-404 and orphan-skip paths will log at `info` level on every hit. During normal operation (when the Flutter client polls getDiff for sessions that don't exist yet, while the stream bridge is setting up the row) this could produce moderate log volume. Acceptable trade-off given the alternative was `logger.error` flooding (the bug being fixed).
