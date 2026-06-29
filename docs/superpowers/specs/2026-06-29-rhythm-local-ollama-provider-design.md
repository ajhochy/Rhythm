---
date: 2026-06-29
repo: Rhythm
branch: codex/mega-open-prs-2026-06-28
status: approved
tags: [design, Rhythm, opencode, ollama]
---

# Rhythm Local Ollama Provider

## Goal

Make the locally installed `qwen3.6-work` Ollama model a first-class model in
Rhythm's embedded OpenCode engine and unified model picker. Existing cloud
providers and fallbacks must continue to work when Ollama is unavailable.

## Current behavior

The live OpenCode server reads `~/.config/opencode/opencode.json`, but Rhythm
builds its picker from a curated provider/model routing table and an auth-backed
provider set. A custom keyless `ollama` provider therefore does not appear merely
because it is present in OpenCode configuration.

## Design

### Local model profile

Create an Ollama model alias named `qwen3.6-work` derived from
`qwen3.6:latest`, with:

- 65,536-token context
- temperature `0.2`
- top-p `0.9`
- presence penalty `0`
- repeat penalty `1.05`

Register an `ollama` OpenCode provider using the OpenAI-compatible endpoint at
`http://127.0.0.1:11434/v1`. Declare only `qwen3.6-work` in this provider's
model catalog, with a 65,536-token context limit. Do not add credentials or
expose Ollama beyond loopback.

### Keyless local-provider discovery

Extend `OpencodeClientService.listAuthedProviders()` so a configured local
`ollama` provider is treated as connected without an auth-store entry. The
provider qualifies only when it exists in the live OpenCode provider catalog;
an unconfigured machine must not report Ollama as available.

This logic remains narrow and explicit. It does not classify arbitrary custom
providers as trusted or connected.

### Rhythm model routing

Add `ollama` to Rhythm's provider-to-agent mapping as an `opencode` provider.
Add `ollama/qwen3.6-work` as the first route for the generic `opencode` agent,
ahead of the existing OpenRouter fallback.

The existing route resolver will select Ollama only when the local provider is
configured. Otherwise it will continue to select the first available cloud
route. The unified model catalog will show `qwen3.6-work` as an authorized
direct model with no connect URL.

### Live activation

The OpenCode process reads provider configuration at startup. After creating the
model alias and updating `opencode.json`, fully restart Rhythm so the Flutter
host respawns both the local API server and the embedded OpenCode server. Do not
reuse the pre-change child processes on ports 4001 or 4096.

## Error handling

- If Ollama is stopped, the model remains selectable but prompting surfaces the
  provider connection failure through the existing OpenCode event/error path.
- If the `ollama` provider is absent from OpenCode configuration, Rhythm does
  not mark it connected and existing fallback behavior is unchanged.
- No automatic fallback occurs after a user explicitly selects the local model;
  silent rerouting would make local/private execution claims unreliable.

## Testing

Add failing tests first for:

1. `listAuthedProviders()` includes `ollama` when the live provider catalog
   contains the configured provider and no auth-store entry exists.
2. It excludes `ollama` when the provider is absent.
3. The resolver prefers `ollama/qwen3.6-work` for the generic `opencode` agent
   when Ollama is connected.
4. The catalog emits the model as authorized, direct, and context-limited.

Then run the targeted Vitest suites, TypeScript checks, the repository issue and
PR verification levels, and a live smoke:

- OpenCode `/provider` lists `ollama` as connected with `qwen3.6-work`.
- Rhythm `/agents/models/catalog` contains the direct local model.
- A temporary Rhythm/OpenCode session prompts `ollama/qwen3.6-work` and receives
  a response.
- `ollama ps` shows the model fully GPU-resident.

## Non-goals

- No general custom-provider framework.
- No Ollama installation or model-download UI.
- No LAN exposure of the Ollama endpoint.
- No changes to MCP scoping, auth credentials, or cloud-provider routing.
