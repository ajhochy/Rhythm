# Project State

## Current focus

**2026-06-24 — Agent scoping parity (P0–P3) implemented + P4 epic designed (VERIFIED, uncommitted).**

All run paths now apply the agent profile's scope, closing the gap where only scheduled runs were scoped:
- **P0** — confirmed the "missing tables" report was a stale-DB artifact, not a migration bug; added a self-heal regression test + decision note.
- **P1a** — extracted `resolveProfileScope(agentConfigId, opts?)`; refactored `agent_runner` onto it (scheduled override byte-for-byte) and wired interactive `ws_gateway` to build + forward `mcpRoleConfig`.
- **P1b** — `allowed_skills_json` filter in skill injection on both runner + WS paths (null = all eligible).
- **P2** — `system_prompt`→prompt `system`, `ocAgent`→prompt `agent` on both paths (SDK has no per-session system prompt; per-prompt body used). #738 guardrail preserved.
- **P3** — importer (`syncOpencodeAgentProfiles`) now sets non-null model, MCP scope (`["rhythm"]`), and a per-agent skill allowlist (`AGENT_SKILL_ALLOWLIST_MAP`) on the 18 imported profiles, and forces `workflow-orchestrator` as the single selectable dev front-door (survives re-sync).
- **P4** — manager→specialist delegation designed (design note + issues P4-1/P4-2). **No code** (awaits user go-ahead).

Run detail: `docs/ai/runs/2026-06-24-agent-scoping-p0-p3.md`. Plan: `docs/ai/current-plan.md`.

The prior Rhythm-native skill-library loop (P1-1…P5 + memory injection) remains implemented and CI-green.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (working tree ahead of HEAD `536b0c6` — P0–P3 changes uncommitted per instruction)
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open (never auto-merge)
- **Base:** `main`

---

## In progress

P0–P3 implementation complete + verification-gate PASS; **not yet committed** (instruction: leave for review). Ready to commit + update PR #734.

Awaiting: (1) manual smoke (`flutter run -d macos`); (2) user go-ahead on the P4 delegation epic.

---

## Risks / known issues

- **P3 — `AGENT_SKILL_ALLOWLIST_MAP` is hand-maintained.** Imported profiles now carry a per-agent skill allowlist; add new chain agents to this map when the registry gains them. `superpowers:*` skill IDs must match runtime IDs exactly. Unknown agents fail-open (null = all eligible).
- **Pre-existing flaky test:** `tasks_controller.test.ts > overdue=yes` intermittently returns 200 vs 400 (shared `_db` singleton + parallel `listen(0)`); unrelated to this work. Follow-up: `docs/ai/generated-issues/FOLLOWUP-flaky-tasks-controller-overdue.md`.
- **Visual gap:** `flutter run` forbidden during coding; run manual smoke before merging.
- **Bundled api_server MCP_ROLES_DIR:** in the `.app` bundle, set `MCP_ROLES_DIR` for role-scoped sessions to resolve `.mcp-roles/`.
- **P1a `allowedTools:[]` for server-name-only profiles:** all tools for that server are accessible (not a per-tool gate); per-tool restriction needs the `.mcp-roles/*.mcp.json` lookup.
- **SDK per-session limits:** no per-session tool allowlist or system prompt at `createSession`; scope applied via `createSession` mcpRoleConfig + per-prompt `system`/`agent`.
- **P4-1 teacher-escalation cost:** failed runs trigger a 2nd stronger-model run (~2x); disable via `AGENT_TEACHER_ESCALATION_ENABLED=false`.
- **Memory injection WS scope:** interactive sessions have no owner → global-only memory (fail-closed). Deliberate.

---

## Test status

| Suite | Status |
|-------|--------|
| `api_server tsc --noEmit` | **PASS — 0 errors** (2026-06-24, P0–P3 working tree) |
| `api_server npm test` | **1155/1155 PASS** (2026-06-24; multiple consecutive green runs; one pre-existing unrelated flake isolated) |
| `dart format .` | PASS — 0 changed (2026-06-23) |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors/warnings (2026-06-23) |
| `flutter test` (full) | **656 PASS, 0 FAIL** (2026-06-24 on HEAD 1412614) |

---

## Next step

1. **Commit P0–P3** to `feature/agent-scheduler` and update PR #734 (orchestrator handoff — do not auto-merge).
2. **Manual smoke** (`flutter run -d macos`): chat session honors profile MCP allowlist (rhythm-only profile can't reach gmail/pco); skill allowlist respected; custom system_prompt/ocAgent take effect; scheduled path unchanged.
3. **P4 delegation epic** — implement only after user go-ahead (D1–D5 in the design note).
4. **Merge PR #734** after smoke passes.

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
