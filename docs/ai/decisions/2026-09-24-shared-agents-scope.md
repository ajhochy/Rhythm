---
date: 2026-09-24
repo: Rhythm
pr: 1544
tags: [decision, rhythm, hermes, shared-agents, security]
---

# Shared-agent scope and native Hermes execution

## Context

The shared workspace package and issue #1540 previously excluded duplicate Rhythm Agents, Profile, Model, Skill, Schedule, and Delegation surfaces. The shared-agents campaign intentionally adds one narrowly governed exception: a canonical shared-agent catalog and editor backed by `docs/ai/contracts/issue-shared-agents.json` and the frozen SA-v1 revision 2 interface spec.

The user explicitly decided that Hermes runs a selected shared agent natively. A Hermes UI backed by OpenCode, a proxied OpenCode transcript, or an ordinary model completion does not satisfy that decision. Rhythm remains the canonical definition source, while Hermes applies the frozen projection to a real native Hermes agent session.

The threat model covers:

- web content and browser origins;
- every renderer, including Rhythm, Hermes, third-party desktop plugins, and model-rendered content;
- prompt-injected or otherwise policy-restricted models, plus subprocesses and MCP servers reachable through their granted tools;
- the remote network and hosted production API; and
- stale identity or runtime after account switch, logout, Hermes backend retirement, or api_server restart.

Native same-user processes with arbitrary code execution, unrestricted-shell agents, OpenCode children using `bypassPermissions`, and code already executing inside Hermes serving or compute processes are outside this boundary. Those actors already have authority equivalent to the local user or trusted host process.

## Decision

Amend issue #1540 criterion c8 to permit only the shared-agent catalog/editor governed by the new contract and this decision. Preserve every other duplicate-surface prohibition.

Hermes executes supported shared agents through its native agent runtime using a server-issued, immutable policy snapshot. Rhythm computes the canonical projection; Hermes validates and enforces it. Unsupported security semantics block launch instead of being flattened or delegated to an OpenCode fallback. Native Hermes profiles remain separate source-owned runtime identities rather than being renamed, merged, or overwritten.

The local bridge uses loopback bearer capabilities with operation-specific scopes and bindings to the local user, server, default profile, runtime generation, and—where relevant—vault identity. Capability material stays out of renderer state, general environments, and child processes. The design does not claim request signing or protection against same-user port squatting.

## Alternatives

- Keep #1540's non-agent-only boundary unchanged. Rejected because it conflicts with the requested shared catalog/editor and would leave the new behavior outside its governing acceptance contract.
- Launch OpenCode behind the Hermes UI or proxy an OpenCode transcript. Rejected because the recorded user decision requires native Hermes execution.
- Copy or merge native Hermes profiles into Rhythm agents. Rejected because the stores and semantics are not losslessly equivalent and native profiles must remain intact.
- Silently drop unsupported permissions or advanced settings. Rejected because it weakens policy and violates the threat model.

## Consequences

- `issue-shared-agents.json` is the acceptance inventory for the exception and lists every frozen §6 test ID exactly once, initially pending.
- The shared-agent catalog/editor is not evidence that any agent is runnable; each runtime exposes explicit readiness and refusal reasons.
- Existing sessions retain their frozen policy snapshot. New edits apply to new sessions, while lock or grant revocation prevents new protected bridge actions.
- Over loopback, bearer possession is sufficient and requests are unsigned. There is no defense against a same-user native attacker or port squatting.
- Renderer and model-facing paths never choose caller identity, capability tokens, arbitrary bridge origins, or unrestricted operations.
- Installed, packaged, hosted, and physical-device qualification remain separate from this contract-only slice.
