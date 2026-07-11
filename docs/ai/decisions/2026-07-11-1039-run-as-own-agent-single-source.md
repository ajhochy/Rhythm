---
tags: [decision, rhythm]
date: 2026-07-11
issues: [1039]
---

# Scheduled/background profile runs: run AS the profile's own `.md` agent

## Context

After #1002 (headless cwd scoping), scheduled/background runs of profile agents
still failed with "model produced no output". Two distinct causes:

- **A.** A profile that is not session-selectable is projected `mode: subagent`
  (`opencode_agent_writer`). `agent_profile_sync` (#858) backfills `oc_agent` to
  the profile id, so AgentRunner passes `agent: <profileId>` to opencode. opencode
  won't resolve a subagent-mode agent as a top-level `agent:` target → "Agent not
  found" → silent no-output.
- **B.** A valid primary profile (AI-Trend-Researcher) returned empty. AgentRunner
  passed `agent: <profileId>` AND a per-message `system:` override. The `.md` body
  already IS the profile's systemPrompt (writer writes `body = systemPrompt`), and
  opencode layers `user.system` AFTER the agent prompt (`session/llm.ts`), so the
  profile prompt was delivered twice.

## Decision

The `.md` agent is the **single source of scoping** for a profile that runs as
its own registered agent.

1. **Writer:** session-selectable → `mode: all` (was `primary`). `all` is both a
   valid top-level agent AND a delegation target, so promoting a specialist to
   schedulable never removes it as a delegate. (Fork enum: `["subagent","primary","all"]`.)
2. **Config-time guard:** scheduling a non-session-selectable (delegation-only)
   profile is rejected at create/update with an actionable 400 instead of failing
   silently at run time.
3. **Runtime:** when running AS the profile's own agent (`ocAgent === configId`)
   and NOT an mcpRole run, drop the duplicate `system:` override. `mcpRole` is the
   discriminator that keeps the self_improvement / measurement path on its
   assembled-scope behavior (it scopes via `mcpRoleConfig`, not the `.md`).
4. **Reaper:** a per-tick `reapStuckSessions` recovers post-boot orphans (boot-only
   `resetStaleRunning` left mid-flight deaths stuck until restart).

## Alternatives considered

- Keep `primary` and rely on `agent.get` (which ignores mode) for delegation —
  works today but `all` is the correct idiom and future-proofs delegate lookup.
- Stop passing `agent:` entirely and rely on `system:` only — abandons the whole
  "profile `.md` is the source of truth" consolidation (#873/#858) and reintroduces
  the provider-prompt path; rejected.

## Consequences

- Dropping `system:` removes a confirmed redundancy, but whether it ALONE restores
  non-empty output for AI-Trend-Researcher is unconfirmed by code reading: opencode
  `session/llm.ts:122` makes `input.agent.prompt` REPLACE the provider agentic
  prompt, and that profile's `.md` denies read/glob/grep with `tools:(none)`. A
  live single-run trace (orchestrator, :4096) is the confirming experiment; if
  still empty, loosen the profile `.md` permissions or don't pass `agent:` for
  tool-less research personas.
- Pre-existing scheduled tasks bound to a now-subagent profile still error at run
  time until re-bound — the guard is create/update-time only, by design.
