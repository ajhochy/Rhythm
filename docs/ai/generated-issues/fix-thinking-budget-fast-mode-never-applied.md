# fix(#604): reasoning-effort + fast-mode toggles render but never reach the SDK

## Problem

PR #617's #604 claim:
> "Variant model IDs (1M context, legacy) + thinking_budget + fast_mode columns + PATCH + WS session.input fields. Header gains compact effort picker and fast-mode toggle."

The UI controls are present and visually responsive (you can flip them). The DB columns exist. The PATCH endpoint works. But the runtime payload **never reaches the SDK call**, so the model never sees the user's preference.

Verified live: set reasoning effort to **Max**, fast-mode **on**, ask Claude Sonnet 4.6 to introspect — Claude reports `extended thinking: not enabled` and can't observe a fast-mode setting. The settings are inert from the model's perspective.

## Root cause

[apps/api_server/src/services/ws_gateway.ts:289-309](apps/api_server/src/services/ws_gateway.ts) builds a `sdkOpts` object and passes it as a 5th argument to `promptFn`:

```ts
const sdkOpts = (effectiveThinkingBudget !== null || effectiveFastMode)
  ? {
      ...(effectiveThinkingBudget !== null ? { thinking: { budget_tokens: effectiveThinkingBudget } } : {}),
      ...(effectiveFastMode ? { fastMode: true } : {}),
    }
  : undefined;

const promptFn = opencodeClient.promptAsync.bind(opencodeClient) as unknown as (
  id: string,
  data: string,
  model?: { providerID: string; modelID: string },
  cwd?: string,
  opts?: Record<string, unknown>,
) => Promise<unknown>;
await promptFn(opencodeId, data, model, cwd, sdkOpts);
```

But [opencode_client_service.ts](apps/api_server/src/services/opencode_client_service.ts) `promptAsync` signature is:

```ts
async promptAsync(
  sessionId: string,
  text: string,
  model?: { providerID: string; modelID: string },
  directory?: string,
): Promise<boolean>
```

Only 4 parameters. The 5th `sdkOpts` is JavaScript's silent drop. Inside `promptAsync`, the SDK body is built without any `thinking` or `fastMode` field, so the opencode binary receives a plain prompt and the model never sees the user's preferences.

## Fix

Two-part:

1. **Service**: extend `OpencodeClientService.promptAsync` (and `prompt`) to accept an optional 5th `opts: { thinking?: { budget_tokens: number }; fastMode?: boolean }` parameter. Merge into the SDK body:
   ```ts
   body: {
     model,
     parts: [{ type: 'text', text }],
     ...(opts?.thinking ? { thinking: opts.thinking } : {}),
     ...(opts?.fastMode ? { fastMode: opts.fastMode } : {}),
   }
   ```
   Confirm the SDK actually accepts these body fields by checking `@opencode-ai/sdk/dist/gen/types.gen.d.ts` for the session.promptAsync request body type. If the SDK doesn't accept them, file a separate upstream issue and remove the controls until upstream lands.

2. **WS gateway**: now that the signature matches, drop the cast-through-unknown trick; call `opencodeClient.promptAsync(opencodeId, data, model, cwd, sdkOpts)` directly. (The binding fix from `49ef628` is preserved either way.)

## Acceptance criteria

- [ ] Set reasoning effort to Max, fast-mode on, send a turn to a thinking-capable Claude model — model report indicates extended thinking IS enabled.
- [ ] Same model, default effort: extended thinking off.
- [ ] Per-turn overrides win over session-level settings (already plumbed in `effectiveThinkingBudget` / `effectiveFastMode`).
- [ ] Existing tests pass; add a test asserting `promptAsync` is called with the `opts` argument when a thinking budget is set.

## Severity

Medium — the controls exist and create user expectation, but their effect is null. Anyone relying on extended thinking or fast mode for cost/latency control gets neither.

## Related

Connected to the binding fix in commit `49ef628`. That fix made the call work at all (it was throwing TypeError); this one makes the call *do the right thing* with the extra args.
