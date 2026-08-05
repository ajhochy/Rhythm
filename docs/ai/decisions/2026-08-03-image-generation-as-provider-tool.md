---
date: 2026-08-03
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Native image generation ships as a provider tool, gated by an explicit permission

## Context

The #1094 per-profile toggle writes `permission.image_generation: allow` into
agent frontmatter, but opencode gates tools by name and no such tool existed.
Something had to register it. Two constraints shaped the choice:

1. **No OpenAI platform API key exists on this machine.** The stored `openai`
   credential is a ChatGPT/Codex-scoped OAuth token; against the platform API
   it returns `403 Missing scopes: api.model.read`. A custom tool calling
   `api.openai.com` with a key cannot authenticate.
2. **Most agents inherit a catch-all `"*": "allow"` permission rule** from the
   built-in defaults.

## Decision

Register `image_generation` as an **AI-SDK provider tool**
(`openai.tools.imageGeneration()`), injected in `SessionPrompt.resolveTools`
rather than through `ToolRegistry`, and gate it on a permission rule that
**names `image_generation` explicitly** — wildcard rules never enable it.

Persist the returned image to the tool-output dir and put the **path** in the
tool output, not the base64.

## Alternatives considered

- **Custom tool calling the OpenAI images REST API.** Rejected: cannot
  authenticate (constraint 1). A provider tool rides the chat turn's own
  connection, which already works.
- **Register it in `ToolRegistry`.** Not possible: every registry entry
  requires an `execute`, and this tool runs on OpenAI's side.
- **Let the gate match wildcards** (i.e. use `Permission.evaluate`). Rejected:
  the inherited `"*": "allow"` would enable image generation for every profile,
  defeating the per-profile toggle (constraint 2).
- **Return the image inline as a base64 attachment.** Rejected: ~1 MB per
  image, re-sent to the model on every subsequent turn. The tool-output dir is
  already allow-listed for `read` via `Truncate.GLOB` and swept after 7 days,
  so the agent can load the image on demand.
- **Treat `ask` as `deny`/`allow`.** Rejected: `ask` is resolved up front,
  before the tool is offered, which is the only point at which a
  provider-executed call can still be prevented.

## Consequences

- The toggle now works, and only for profiles that set it.
- Two general provider-executed-tool defects were fixed as a side effect: tool
  parts were never registered for such calls (so results vanished from the
  transcript), and the SDK's duplicate result caused a second copy of every
  image to be written to disk. Any future provider tool (web search, code
  interpreter, local shell) benefits.
- `ask` prompts once per engine boot rather than per turn, because "always"
  persists in the instance-level approvals.
- Scope is limited to `providerID === "openai"` and `api.npm ===
  "@ai-sdk/openai"`. Azure and github-copilot's vendored Responses model also
  accept the tool id but are untested here; add them when there is a profile to
  test against.
