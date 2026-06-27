---
date: 2026-06-25
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Decision: Wire `notifyEngineReady` from `server.ts`, not from `opencode_client_service.ts`

## Context

Issue #746 required the skill curator (`queueSkillExtraction` in `skill_extractor.ts`) to know when the opencode engine finished initializing, so it could start a 90-second cold-start window during which extraction is deferred.

The natural place to call `notifyEngineReady()` is inside `OpencodeClientService._initializeImpl()` — right after `restoreAuth` completes, where `_engineReadyAt` is already set.

## Decision

Call `notifyEngineReady()` from `server.ts` inside the `opencodeClient.initialize().then()` callback, not from `opencode_client_service.ts` directly.

```typescript
// server.ts
opencodeClient.initialize().then(async () => {
  const readyAt = opencodeClient.engineReadyAt ?? Date.now();
  const { notifyEngineReady } = await import('./services/skill_extractor');
  notifyEngineReady(readyAt);
  ...
});
```

## Alternatives considered

1. **Import `notifyEngineReady` in `opencode_client_service.ts`** — would create a circular dependency chain: `opencode_client_service` → `skill_extractor` → (indirectly) `opencode_client_service` via the distill flow. Node module system resolves circular ESM/CJS dependencies inconsistently; if `skill_extractor` imports something that eventually imports `opencode_client_service`, the reference could resolve to `undefined` at load time.

2. **Emit a Node.js EventEmitter event** — would decouple cleanly but adds event plumbing for a single use-case; overkill.

## Consequences

- `server.ts` is already the integration point for all fire-and-forget init work (Claude auto-bridge, plugin config, agent scheduler seed). Adding `notifyEngineReady` here is consistent with that pattern.
- `OpencodeClientService` exposes `engineReadyAt` as a public getter so `server.ts` can pass the precise timestamp (not `Date.now()` at callback time, which could be milliseconds later).
- The dynamic `import('./services/skill_extractor')` in the `.then()` is wrapped in a non-fatal try/catch — a failure here must never block server startup.
