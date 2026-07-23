---
date: 2026-07-23
repo: Rhythm
branch: fix/1143-custom-provider-model-picker
pr: (pending)
issues: [1143]
status: verified
tags: [run, rhythm]
---

# #1143 — custom openai-compatible providers never appear in the model picker

## Summary

A custom provider in `~/.config/opencode/opencode.json` (e.g. `glm-mesh/glm-4.6`)
is loaded and selectable by the engine (`opencode models` lists it) but never
showed up in the Rhythm UI model picker. Root cause: the api_server model
catalog (`GET /agents/models?agentId=<id>` and `/agents/models/catalog`,
`agents_models_routes.ts`) only emitted models drawn from two hardcoded maps in
`agent_model_resolver.ts` (`PROVIDER_TO_AGENT_KIND`, `ROUTE_FALLBACKS_BY_AGENT`)
— neither derived from the live engine catalog — so a provider defined only in
opencode.json had no entry in either and was skipped. Even the `/catalog`
"live direct entries" loop only iterates `PROVIDER_TO_AGENT_KIND` and gates each
model through `isEligibleDirectModel`, whose prefix check excludes any unknown
provider.

## Fix

1. New `OpencodeClientService.listProviders()` — enumerates the FULL live
   provider catalog (`config.providers()`, the same catalog `opencode models`
   reads), each provider with its models. Never throws.
2. `/agents/models/catalog`: new `buildCustomProviderEntries()` merge —
   any live provider NOT in the static maps (and not an aggregator) is emitted
   as a generic `opencode`-kind **direct** row, `authorized: true` (config-
   defined = usable, exactly how the engine treats it), carrying contextLimit.
   Deduped against already-emitted keys.
3. `/agents/models?agentId=opencode`: the same custom providers are appended
   under the generic `opencode` kind (only for that agentId — custom providers
   don't leak into claude-code/codex/gemini pickers).

Defensive: a `listProviders` failure degrades to zero custom entries — it must
never empty the whole catalog (this file's degrade-gracefully contract). That
guard also fixed a regression where a test mock lacking `listProviders` threw
and blanked the catalog.

## GitNexus

- `query()` mapped the catalog handlers + the two static maps.
- `impact({target:'loadProviderModelIds', direction:'upstream'})` → LOW.
- `detect_changes()` before commit → LOW, 0 affected processes.

## Checks

- `tsc --noEmit` → 0.
- Unit: `agents_models_catalog.test.ts` (+4 new #1143 tests: custom provider in
  /catalog, no double-emit of known providers, custom in
  /agents/models?agentId=opencode, no-leak into claude-code) +
  `agents_models_routes.test.ts` + regression (637/639/model_routing) → 41 pass.
- **Live behavioral (verification gate):**
  ```
  tools/dev/sandbox.sh up   # api :4098, engine :4097, built from this branch
  RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
    RHYTHM_SANDBOX_OPENCODE_JSON="$SB/home/.config/opencode/opencode.json" \
    npx vitest run src/__tests__/live_e2e_1143_custom_provider.test.ts
  # → 1 passed. Injected a custom openai-compatible provider (inline models)
  #   into the sandbox opencode.json, POST /system/refresh reloaded the engine
  #   catalog, GET /agents/models/catalog then returned the provider as an
  #   opencode-kind direct row. Re-run after the defensive-guard change → still
  #   passed.
  ```

## Cleanup

- Restored `apps/opencode_fork/bun.lock` (sandbox build artifact).
- Sandbox will be brought DOWN after this bug (last of the three).

## Next

Commit → push → draft PR for #1143. Then bring the sandbox down, write the
combined summary + manual-smoke checklist.
