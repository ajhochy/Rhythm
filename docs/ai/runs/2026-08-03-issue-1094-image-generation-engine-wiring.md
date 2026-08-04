---
date: 2026-08-03
repo: Rhythm
branch: workflow/run-2026-08-03-image-generation
pr: 1304
issues: [1094]
status: awaiting-manual-smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #1094 — native OpenAI image_generation engine wiring

## Problem

The per-profile "native OpenAI image generation" toggle was a no-op for every
profile. The Rhythm half was already complete and correct (migration,
repository mapping, controller, and `opencode_agent_writer.ts` projecting
`permission.image_generation: allow` into frontmatter — confirmed present in
`~/.config/opencode/agents/creative-media.md`). opencode gates tools **by
name**, and no tool named `image_generation` was ever registered, so the
permission was silently inert. Nothing in the Rhythm half was changed.

## Files changed

- `apps/opencode_fork/packages/opencode/src/tool/image-generation.ts` (new) —
  permission gate, AI-SDK provider tool, PNG persistence.
- `apps/opencode_fork/packages/opencode/src/session/prompt.ts` — inject the
  provider tool in `resolveTools`; instrumentation fields
  `imageGeneration` / `imageGenerationOffered` on the existing
  `resolveTools complete` debug line.
- `apps/opencode_fork/packages/opencode/src/session/processor.ts` — register a
  tool part for provider-executed calls; adapt the `{result: <base64>}`
  payload; skip the duplicate result.
- `apps/opencode_fork/packages/opencode/test/tool/image-generation.test.ts` (new) — 9 tests.
- `apps/api_server/src/services/opencode_agent_writer.ts` — return a write status.
- `apps/api_server/src/controllers/agent_configs_controller.ts` — resync maps
  blocked→400, failed→500.
- `apps/api_server/src/__tests__/agent_configs_routes.test.ts` — 2 new route tests.

## Checks run

- Fork typecheck 0 errors; api_server typecheck 0 errors.
- Fork `bun test`: 2712 pass / 1 fail — `ModelsDev … disk empty and fetch
  disabled`, **pre-existing** (fails identically on unmodified tree).
- api_server `vitest run`: 3821 pass / 5 fail — curated-MCP + agent-approvals,
  **pre-existing** (baselined on unmodified tree).
- Fork `bun run build --single` exit 0; api_server `npm run build` exit 0.
- `classify.cjs`: `FATAL=0 SKIPPED=0 WARN=0 OK=33`.
- Live, rebuilt binary, `openai/gpt-5.6-sol`:
  - granted profile → `image_generation` in the wire tool list, transcript
    shows `TOOL image_generation completed` with the path, exactly **one**
    1254×1254 PNG in the tool-output dir;
  - same model without the grant → `imageGenerationOffered=false`, model
    answers "I can't access an image-generation tool in this session";
  - `anthropic/claude-sonnet-4-6` → `imageGenerationOffered=false`, answers
    normally, no error.

## Notes

- **Why a provider tool and not REST.** There is no OpenAI platform API key on
  this machine. `OPENAI_API_KEY` is absent from env and `apps/api_server/.env`;
  the stored `openai` credential is `type: "oauth"` (ChatGPT/Codex-scoped) and
  returns `403 Missing scopes: api.model.read` against the platform API.
  `rhythm doctor`'s "✅ OpenAI API key" is not evidence of a key —
  `cli/checks/api_keys.ts` passes on `isSet(...) || authedProviders.includes('openai')`
  and only the second term is true. A provider tool rides the chat turn's own
  authenticated connection, which already works.
- **Where the OAuth path actually goes.** `plugin/codex.ts` rewrites every
  `/v1/responses` request to `https://chatgpt.com/backend-api/codex/responses`.
  That backend **does** support hosted `image_generation` — probed directly, it
  returns an `image_generation_call` with a ~1.1 MB base64 result.
- **The gate must ignore catch-all rules.** Most agents inherit `"*": "allow"`
  from the built-in defaults, so a wildcard-matching gate would enable image
  generation for every profile. Only a rule naming `image_generation` counts.
- **Two general provider-executed-tool defects found and fixed**, not specific
  to image generation:
  1. Provider-executed calls arrive as `tool-call` with **no preceding
     `tool-input-start`** — the event that registers the tool part. Without a
     registered part, every later update including the result silently
     no-opped. This is why the generated image never reached the transcript
     even once the tool was being called correctly.
  2. The SDK delivers the provider result **twice** for one call id;
     `completeToolCall` ignores the second, but the file write happened before
     that check, so every image was written to disk twice.
- **`ask` semantics.** A provider-executed call is already complete when it
  reaches us, so there is no mid-call hook. `ask` is resolved up front before
  the tool is offered; "always" persists for the instance, so it is one prompt
  per engine boot, not per turn.
- **Incidental (no commit).** The fork's `node_modules` was missing workspace
  deps (`tailwindcss`, `zod`, `@opentui/*`), which broke `bun run build` in the
  embedded web-UI step and caused 3 test failures plus 26 tsc errors. A plain
  `bun install` in `apps/opencode_fork` fixed all of it with no lockfile
  change. The build cannot be reproduced without it.
- #1094 is already CLOSED (the Rhythm half shipped), so the PR uses no closing
  keyword.

## Manual smoke handoff

Fully quit and relaunch Rhythm — the engine only reads agent files on a fresh
boot, `/config/reload` will not pick this up. The installed app runs
`/Applications/Rhythm.app/Contents/Resources/opencode_bin/opencode`, so that
binary must be replaced or nothing takes effect. Then ask `creative-media` for
an image.

## Dev-app launch findings (2026-08-03, post-merge with main @ dd60008c)

Merged `main` into this branch locally for combined live testing (one conflict,
`docs/ai/project-state.md`, resolved). Two environment traps surfaced while
launching the dev app, both of which silently produce misleading results:

1. **The dev launcher stages the engine to a shadowed path.** The app resolves
   its engine from `apps/opencode_bin/` (three levels up from
   `dist/services`), but `tools/dev/launch_desktop_current.sh` stages to
   `apps/api_server/opencode_bin/`. A gitignored July 9 binary
   (`0.0.0-main-202607092109`) at the winning path had been serving every dev
   session. That is why a `creative-media` chat reported "GPT Image generation
   is not available in this session" at 18:49 — a month-old engine, not a
   broken feature. Staging to `apps/opencode_bin/` (with an ad-hoc
   `codesign --force --sign -` after `cp`, or AMFI SIGKILLs it) fixed it.
   Filed as issue #1305. Always compare the running engine's `--version`
   against the freshly built one before trusting a dev smoke.
2. **Engine DBs are per-branch**, named `opencode-<sanitized-branch>.db` under
   `~/.local/share/opencode/` (`storage/db.ts:26-38`). Switching branches
   points the app at a different session store, so existing chats vanish from
   the UI. `OPENCODE_DB=<filename>` overrides it; launching the app binary
   directly (not via `open`) propagates the env to the engine child.

Live confirmation in the running dev app, real `creative-media` profile on
`openai/gpt-5.6-sol-pro`: `⚙ image_generation Generated image`, and a
transcript check showed **1 distinct call id → 1 PNG**, confirming the
duplicate-write guard holds end to end. (An earlier run produced two images of
different dimensions and checksums — that was the model making two genuine
calls, not a duplicate write.)
