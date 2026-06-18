---
date: 2026-05-26
repo: rhythm
tags: [decision, rhythm]
---

# agent pill resolves provider→agent-kind, not raw providerId (#645)

**Context:** The Agents agent pill (`_AgentKindBadge`) showed a stale icon/label after the user switched the session's model. Root cause: `setSessionModel` updates the session's `providerId`/`modelId` but never `agentId`, and the badge looked up `byId(session.agentId)`. A first fix tried `byId(session.providerId)` — but `CatalogModelEntry` has TWO distinct fields, `agent` (claude-code/codex/gemini-cli) and `provider` (anthropic/openai/google), and `_applyPick` stores `providerId: entry.provider`. So a codex model stores `providerId='openai'`, and `byId('openai')` returns null (config ids are agent-kinds) → it fell back to the stale agentId. The contract test passed only because it injected `providerId='codex'`, a value the app never stores — a **false green**.

**Decision:** Resolve the displayed agent through a provider→agent-kind map (`_kProviderToAgentKind`: anthropic/github-copilot→claude-code, openai→codex, google→gemini-cli) that mirrors the server's `ws_gateway.ts` `PROVIDER_TO_AGENT`, then `byId(mappedKind)`; prefer the mapped config only when it differs from `agentId`. Also switched `context.read` → `context.watch` so the badge rebuilds on controller changes. Contract test rewritten to use real provider values (`openai`→Codex, `google`→Gemini CLI), proven red-then-green.

**Process note:** The false green was caught by orchestrator trust-but-verify (comparing the test's injected value against the real value flowing from `_applyPick`), NOT by the green test run. Lesson for behavioral contracts: assert with the value the production code path actually produces, not a convenient stand-in. When a UI value is derived through a mapping, the test must feed the upstream (pre-mapping) value.

**Consequences:**
- + Pill reflects the resolved agent for all real provider values; mapping is centralized and matches the server.
- + `context.watch` keeps the pill live on config refreshes.
- - The Flutter map duplicates the server `PROVIDER_TO_AGENT`; if the server adds a provider, both must change. Acceptable for now (two small maps); a shared source could be considered later.
- Landed on branch `fix/issue-643-645-agents-ui`, PR pending.
