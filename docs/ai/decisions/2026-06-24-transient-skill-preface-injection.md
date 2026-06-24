---
index: "[[Rhythm]]"
date: 2026-06-24
repo: Rhythm
tags: [decision, Rhythm]
---

# Skills inject as a transient prompt preface, never persisted

## Context

P3-2 injects relevant skills into the agent's prompt so the library actually
feeds back into runs. The tension: "inject skills into the prompt" vs. "agent
prompts / profiles stay stable" (the whole premise — the skill *library* is the
evolving layer, not the agent definitions).

## Decision

The matched-skills "## Available skills (retrieved)" block is built **per prompt**
and prepended only to the in-memory string sent to the model
(`agent_runner.ts` effectivePrompt → `opencodeClient.prompt`; `ws_gateway.ts`
forwarded text). It is **never** written to:
- the Agent Profile `systemPrompt` (`agent_configs`),
- the opencode agent `.md` files (`opencode_agent_writer.ts` is asserted
  not-called in tests),
- session message history (the original prompt is what gets persisted).

Injection is gated by `AGENT_SKILLS_ENABLED` (instance-wide, default ON,
live-read via `isSkillInjectionEnabled()`), and each injected skill's `uses`
counter is incremented (the self-improvement signal).

## Alternatives

- **Bake skills into the profile/`.md` systemPrompt:** rejected — would mutate the
  stable agent definition, fork it from the agent-stack source, and bloat
  always-on context. Transient injection keeps the agent definition stable and
  the skill set dynamic.

## Consequences

- Agent prompts/profiles remain a stable, reviewable surface; the skill library
  evolves independently.
- Each matched interactive turn adds tokens (bounded by top-5 + 0.3 relevance
  threshold).
- A frequently-matched skill's `uses` climbs fast — intended ranking signal, worth
  noting for any future uses-weighted scoring.
