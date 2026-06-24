# Current Plan — Agent-profile scoping parity across all run paths

**Date:** 2026-06-24
**Branch:** stack on `feature/agent-scheduler` (PR #734) — do NOT branch off `main` (main is far behind and lacks the Agent Profile + skill-library foundation this builds on). Manual merge only; never auto-merge.
**Status:** PLANNED — ready for issue-writer → acceptance-contract → coding-agent. Scope policy: plan AND implement P0–P3 this run; P4 is a separate epic (issues + design note ONLY, no code). File follow-ups for out-of-scope discoveries; never silently expand.

---

## User request (one sentence)

Make every agent run path (interactive chat/WebSocket, scheduled, cookbook/ad-hoc) enforce the SAME agent-profile scope — MCP allowlist, skill allowlist, system prompt, ocAgent, and model — by extracting one shared scope-builder helper that today only the scheduled path effectively uses.

## Goal

A single shared "profile scope" seam — one helper that, given an `agentConfigId`, resolves `{ model, mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }` — called by BOTH `agent_runner.ts` (reference/scheduled path) and `ws_gateway.ts` (interactive path). After this work an interactive session scoped to `allowed_mcps=["rhythm"]` cannot invoke gmail/pco tools; skills outside `allowed_skills_json` are never injected on either path; a profile `system_prompt` demonstrably influences the session; and the 18 imported AI-Workflow profiles carry sensible models + scoping so they no longer run unscoped on a fallback model.

## Non-goals

- NOT hand-creating the three `agent_skills` / `agent_scheduled_tasks` / `agent_cookbook` tables (P0 is a regression test + documentation only — the tables already migrate correctly; the failure report queried a stale, gitignored repo-local `rhythm.db`).
- NOT committing the stale `apps/api_server/rhythm.db` (untracked, gitignored dev artifact).
- NOT changing model PRECEDENCE semantics — preserve: per-turn override > session selection > profile default > catalog fallback.
- NOT building the manager/delegation runtime (P4 is design + issues only).
- NOT touching the production Postgres path for the agent-only scoping logic (agent runs are local-SQLite; Postgres no-ops, same posture as the skill library).
- NOT changing the agent-stack `sync-globals` behavior in THIS repo (that's the separate agent-stack PR P0-1 already tracked in decisions).

## Hard constraints (from AGENTS.md / project memory)

- **Agent traffic is hard-pinned to `localhost:4001`** — never couple scope resolution to `serverConfigService.url`.
- **Dual-DB / schema drift:** any new column needs a guarded `CREATE/ALTER` in BOTH `migrations.ts` (SQLite) and `postgres_bootstrap.ts`; tests are SQLite-only, so Postgres columns are mirrored by hand and asserted in a column-parity test.
- **Transient injection invariant:** prefaces (skills/memory) and any scope-derived prompt text must remain in-memory for the send only — NEVER persisted to `config.systemPrompt`, the message store, or an opencode agent `.md`.
- **Test-env guards:** the live opencode/model path is `isTestEnv()`-inert; wiring is proven by injected-dep unit tests + forwarded-prompt capture, not end-to-end (same pattern as P2–P5 of the skill library).
- **`dart format` / `flutter analyze --no-fatal-infos` / `tsc --noEmit` / vitest** must all pass before PR.
- **SDK limitation (known):** `session.create()` accepts only `{ title, directory }` — there is NO per-session tool-allowlist param. `createSession`'s `mcpRoleConfig` arg is a passthrough that callers/tests spy on; enforcement is "store allowlist on the session row + gate at the WS/runner send seam." The same limitation governs per-session system prompt (P2 must investigate whether the current SDK has changed this).

## Design tensions

- **One shared helper vs. two divergent call sites.** The whole point is to converge them; but the two paths differ (runner uses synchronous `prompt()` and has no live SSE consumer; WS uses fire-and-forget `promptAsync()` driven by the stream bridge). The helper must return DATA (a resolved scope object), not perform the send — each path keeps its own send mechanics.
- **Profile scope vs. per-call scope.** Scheduled runs already carry `allowedMcpsJson` from the SCHEDULED-TASK row (not the profile). Interactive sessions have no such per-call field — their scope must come from the PROFILE (`agentConfigId` = `agentKind`). The helper resolves profile scope; a caller may still pass an explicit per-call `allowedMcpsJson` that takes precedence (scheduled-task case). This keeps the scheduled path byte-for-byte unchanged.
- **MCP enforcement reality.** Because the SDK can't gate per session, the "scope" for MCP on the interactive path = building `mcpRoleConfig` from the profile's `allowed_mcps_json` and passing it through `createSession` (init-time, same as the controller's `mcpRole` path) PLUS not surfacing disallowed tools. Acceptance must be framed against the same observable seam the scheduled path uses (mirror `issue_738_agent_runner.test.ts`), not against a guarantee the SDK doesn't provide.

## Cheapest version that proves the idea

Extract `resolveProfileScope(agentConfigId, overrides?)` returning `{ model, mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }`; have `agent_runner._runOnce` call it (replacing its inline `resolveRunModel` + profile load + `mcpRoleConfig` build) with ZERO behavior change (regression-locked by existing #738 tests); then have `ws_gateway.handleInputFrame` call the same helper and (a) build+pass `mcpRoleConfig` on the resume/create seam and (b) pass `allowedSkillsJson` into `buildSkillsPreface`. That single seam is where P2 (system_prompt/ocAgent forwarding) and P4 (delegation re-scope) later slot in.

---

## Prior Art

Swarm not dispatched: this is an internal refactor over already-understood Rhythm code (no new dependency, no third-party API, no known-hard external pattern). The authoritative "prior art" is the in-repo reference path itself — `agent_runner.ts` `_runOnce` (model resolution `resolveRunModel` ~203–241; profile load ~488–506; `mcpRoleConfig` build ~575–603) and the scheduled-path scope test `src/__tests__/issue_738_agent_runner.test.ts`. The interactive path (`ws_gateway.ts handleInputFrame` ~226–690) and `agent_sessions_controller.ts create()` (~216–471, MCP role resolution ~303–335) are the divergent sites to converge. `skill_retrieval.ts buildSkillsPreface/getRelevantSkills` (~158–245) is the skill-injection seam that needs an allowlist filter parameter.

---

## Phased issues

### P0 — Migration regression test + finding documentation (NOT a bug)
The three tables (`agent_skills`, `agent_scheduled_tasks`, `agent_cookbook`) already migrate cleanly on fresh AND existing runtime DBs; `runMigrations` runs every boot (`db.ts:62`); the runtime DB at `~/Library/Application Support/Rhythm/rhythm.db` HAS all three. The failure report queried the STALE, untracked, gitignored repo-local `apps/api_server/rhythm.db` that is never re-migrated. Deliverable: a regression test that asserts migrations are self-healing, plus a decision note documenting the stale-file trap. Do NOT hand-create tables; do NOT commit the stale file.

### P1 — Scoping parity on interactive (chat/WebSocket) sessions (the real work)
Split into P1a (shared helper + MCP scope on interactive) and P1b (skill allowlist filter on both paths).

- **P1a** — Extract `resolveProfileScope(agentConfigId, { allowedMcpsJsonOverride? })` → `{ model, mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }`. Refactor `agent_runner._runOnce` to consume it (no behavior change, regression-locked). Wire it into `ws_gateway.handleInputFrame`: build `mcpRoleConfig` from the PROFILE's `allowed_mcps_json` and pass it to the `createSession`/resume seam so interactive sessions are MCP-scoped exactly as scheduled runs are.
- **P1b** — Add an `allowedSkillsJson` filter parameter to `getRelevantSkills`/`buildSkillsPreface`; thread the profile's `allowed_skills_json` through the helper on BOTH paths so skills outside the allowlist are never injected (null/absent allowlist = current behavior, all skills eligible — backward compatible).

### P2 — Profile fidelity (system_prompt + ocAgent) forwarded on both paths
`agent_runner` loads `systemPrompt`+`ocAgent` but TODO-drops them (~503–505). Investigate whether the current `@opencode-ai/sdk` supports a per-session system prompt (read `node_modules/@opencode-ai/sdk` types). If yes: forward it via the helper on both paths. If no: implement a documented fallback (first-turn system injection OR per-turn agent override) applied consistently through the P1 helper. Forward profile `ocAgent` to both paths (today only per-turn via `ws_gateway` ~290–292). Record the SDK capability finding in `docs/ai/decisions/`.

### P3 — Profile config hygiene (18 imported AI-Workflow agents)
The importer is `services/agent_profile_sync.ts` `syncOpencodeAgentProfiles` (inserts at `sortOrder: 100`). It backfills `systemPrompt`/`model` ONLY from the opencode registry entry (`agent.prompt` / `agent.model`) and never sets `allowed_mcps_json`/`allowed_skills_json`; agents without a registry model fall through to `ROUTE_FALLBACKS_BY_AGENT` and run unscoped. These rows are SYNC TARGETS — direct DB edits get clobbered on re-sync, so the FIX must live in the importer. Make the importer (a) map Tier 1/2/3 mentions in the agent's prompt/metadata to concrete models when `agent.model` is absent; (b) populate sensible `allowed_mcps_json`/`allowed_skills_json` defaults; (c) de-dup dev front-doors (superpowers / workflow-orchestrator / plan are all `sessionSelectable` — pick ONE primary, set the others `sessionSelectable=false`), importer-driven.

### P4 — Manager delegation (SEPARATE EPIC — issues + design note ONLY, no code)
`is_manager` exists but is unused. Desired: a delegation tool for manager profiles that invokes a target Rhythm profile as a sub-run RE-SCOPED via the P1 `resolveProfileScope` helper and returns the result; an allowed-delegates list on `agent_configs`; `is_manager` activated for authorization. Deliverable NOW: a planning issue set + a design note in `docs/ai/decisions/` describing the delegation seam riding on the P1 helper. No implementation.

---

## Dependency order

```
P0  (independent — migration regression test + doc)
P1a (shared helper + interactive MCP scope)  ──→ P1b (skill allowlist filter, both paths)
                                              ──→ P2  (system_prompt + ocAgent via the helper)
                                              ──→ P4  (design note references the helper seam)
P3  (independent — importer hygiene; touches agent_profile_sync.ts only)
```

- P0 and P3 are independent of everything and of each other.
- P1a is the keystone: P1b, P2, and the P4 design all build on `resolveProfileScope`.
- P1b can land in the same PR as P1a or immediately after.
- P2 must consume the P1a helper (do not re-load the profile separately).
- P4 produces no code; its design note must cite the P1a helper signature.

---

## Validation plan

| Phase | Required validation |
|---|---|
| P0 | New vitest: run `runMigrations` on (a) a fresh `:memory:` DB and (b) a DB pre-seeded with an OLD schema lacking the 3 tables; assert all three exist afterward with their intended columns. `tsc --noEmit`. |
| P1a | New vitest mirroring `issue_738_agent_runner.test.ts`: interactive turn for a profile with `allowed_mcps_json=["rhythm"]` builds an `mcpRoleConfig` that excludes gmail/pco; a gmail-scoped profile includes gmail. Regression: existing #738 runner tests still green (helper extraction is behavior-preserving). |
| P1b | New vitest: `buildSkillsPreface(query, { allowedSkillsJson })` excludes a high-scoring skill that is outside the allowlist; null allowlist keeps current behavior. Assert on both the runner and WS forwarded-prompt capture. |
| P2 | If SDK supports per-session system prompt: test that the resolved scope forwards it. If not: test the documented fallback (first-turn injection / per-turn agent) fires on both paths. SDK finding recorded in decisions (auditable). |
| P3 | Importer unit test: after `syncOpencodeAgentProfiles` over a fixture registry, imported rows carry a concrete model + non-null `allowed_mcps_json`/`allowed_skills_json`; exactly one of the dev front-doors is `sessionSelectable=true`. `GET /agent-configs` reflects it. |
| P4 | None (no code). Design note exists in `docs/ai/decisions/`; issues filed. |
| All | `cd apps/api_server && npx tsc --noEmit && npx vitest run` green; Flutter unaffected (no Dart changes expected — verify with `flutter analyze`). |

---

## Clarification interview

Skipped the full AskUserQuestion round: the dispatch brief already pins each phase's observable outcome, boundary, and non-goals concretely (P0 verified-not-a-bug; P1 acceptance mirrors `issue_738_agent_runner.test.ts`; P3 names the importer file). The two genuine unknowns are technical, not preference-based, and are recorded under Open Questions for the implementing agent to resolve by reading code (SDK types / agent-stack definitions) rather than by asking the user.

## Known Ambiguities / Open Questions

1. **P2 — does the current `@opencode-ai/sdk` support a per-session system prompt?** The 2026-05/06 code says no (TODO at `agent_runner.ts` ~503–505; `createSession` only forwards `{title,directory}`). The implementing agent MUST re-check `node_modules/@opencode-ai/sdk` types before choosing forward-vs-fallback. Resolve by reading the SDK, then record in decisions. (W4 risk if guessed.)
2. **P3 — Tier→model mapping source.** The importer can read `agent.model` from the opencode registry, but agents synced WITHOUT a model need a Tier 1/2/3 → concrete-model map. Where does the canonical tier→model mapping live (agent-stack agent definition frontmatter? a Rhythm constant? the `tier1` alias remap to `opus-4-8` noted in memory)? The implementing agent must locate the authoritative source; if none exists, propose a small mapping constant in the importer and flag it for review.
3. **P3 — which dev front-door is the single primary?** superpowers vs. workflow-orchestrator vs. plan. Default recommendation: `workflow-orchestrator` (it is the documented global entry point in CLAUDE.md). Confirm during issue-writing.
4. **P1 MCP "cannot invoke" acceptance wording.** The SDK provides no hard per-session tool gate, so acceptance is "the `mcpRoleConfig` passed to `createSession` excludes the disallowed servers" (the same seam the scheduled path is tested against), NOT a runtime tool-call rejection. issue-writer should phrase the criterion against the spy-able seam to avoid an untestable contract.

---

## Data-safety notes

- The stale `apps/api_server/rhythm.db` is gitignored — confirm it is NEVER staged/committed during P0.
- Memory injection owner-scoping is unchanged here; the interactive path remains global-only (no owner column on `agent_sessions`). The skill ALLOWLIST (P1b) is profile-scoped, not user-scoped — no cross-user concern, but the allowlist must fail OPEN to "all skills" on null (backward compatible), distinct from memory's fail-CLOSED-to-global posture.
- All scope-derived prompt text stays transient (the transient-injection invariant above).
