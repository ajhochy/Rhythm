---
date: 2026-06-28
repo: Rhythm
branch: feature/unify-skills-source-of-truth
status: planning
tags: [plan, Rhythm]
---

# Plan — Unify skills into one source of truth on the opencode engine

## Intent (one sentence)

Make the opencode engine's filesystem skill store the **single source of truth**
for skills, so the Flutter "Skills" menu reads the engine's live discovered skills
and writes Rhythm-owned skills back into that same store — eliminating the three
hardcoded skill-name lists that drift from what the engine actually serves.

## In scope

- api_server **proxies** the fork's `GET /skill` (read) and gains **write/delete**
  endpoints for SKILL.md files inside a dedicated **Rhythm-managed skills dir**.
- The Rhythm-managed dir is registered with the fork **additively** via
  `config.skills.paths` (no existing skill relocated).
- A fork **re-scan trigger** (`Skill.reload()` → `InstanceState.invalidate`) so
  newly written/edited/deleted SKILL.md appear without an engine restart.
- Both Flutter pickers source **live** data: skills from `GET /opencode/skills`,
  MCPs from the live MCP list. The skills picker also **writes** Rhythm-owned
  skills (create/edit/delete) through api_server.
- `agent_profile_sync` derives/validates allowlists against the **live** skill set
  instead of the hand-kept `WORKFLOW_CHAIN_SKILLS` constant.
- **System B (DB store) → materialize-on-publish**: publishing a DB skill writes a
  SKILL.md into the managed dir (joining the canonical store) + triggers reload.
- A **names-alignment** test (`allowed_skills_json` names ⊆ `GET /skill` names) and a
  **no-skill-lost** discovery-count/name check (counts/names unchanged before/after
  registering the managed dir).

## Non-goals (explicit)

- **Not** relocating or clobbering `~/.claude/skills` (a `sync-globals` target) or any
  existing discovered skill. Registration is additive only.
- **Not** adding a write API *inside the fork* — api_server writes files directly into
  the managed dir (the fork only gains a read-only reload trigger).
- **Not** making external skills (plugins, other tools' `~/.claude/skills`, superpowers,
  anthropic-skills) writable/deletable — they remain **show + scope only**. Rhythm
  writes/deletes **only** within its own managed dir.
- **Not** shipping the signed release this run — the fork binary change needs a rebuild +
  signed release to go live (manual follow-up, same as #775). Fork logic is covered by
  fork unit tests + a real-binary smoke.
- **Not** removing System B's extractor/refiner/retrieval/seed services or the Flutter
  `agent_skills` feature — they become the authoring layer feeding materialize.

## Hard constraints

- **#775 enforcement must keep working** and names must stay aligned:
  `allowed_skills_json` names MUST equal the fork's `GET /skill` `name`s, or scoping
  silently matches nothing. (Decision: 2026-06-28-skill-scope-enforcement.md.)
- Fork discovery is **memoized in `InstanceState`** (skill/index.ts:242-261) — writes
  are invisible until the cache is invalidated.
- Agent traffic is hard-pinned to `http://localhost:4001` (`AppConstants.agentLocalBaseUrl`);
  the production server URL must never affect skill traffic. The new Flutter data source
  uses the agent-local base, like the other agent data sources.
- DB engine drift: api_server tests are SQLite; prod is Postgres. Any new column needs a
  Postgres backfill (postgres_bootstrap.ts). (This plan adds no new agent_configs columns.)
- `dart format .` + `flutter analyze --no-fatal-infos` must pass before PR.
- Fork edits require rebuilding the fork to test against the BUILT binary; `cp` breaks the
  signature (re-sign ad-hoc). Verify against the built binary, not a mock.

## Design tensions

- **One canonical store vs. don't-lose-a-skill**: registering a new managed dir is additive,
  but a mistake in the config writer could drop the external scan dirs. → no-skill-lost guard.
- **Live-sourced allowlists vs. domain intent**: which agent gets which skills is product
  logic (orchestrator → all workflow-chain skills). We keep the *intent map* but drive the
  actual emitted names from — and validate them against — the live set, so a renamed/removed
  engine skill can't silently scope to nothing.
- **Fast iteration vs. fork rebuild cost**: the fork re-scan can't be exercised end-to-end
  without a rebuild. We isolate fork logic behind unit tests + a real-binary smoke so the
  bulk of the work is testable in CI without a signed release.

## Cheapest end-to-end path (proves the idea)

1. api_server proxies `GET /skill` → Flutter skills picker lists the engine's real skills.
2. That alone retires `_kAvailableSkills` and guarantees name-alignment with #775.
   Everything else (write path, managed dir, reload, materialize) layers on top.

## Architecture decision

Recorded in `docs/ai/decisions/2026-06-28-unify-skills-source-of-truth.md`.

## Prior Art (in-repo — no external swarm warranted)

Every piece mirrors an existing pattern in this repo; the swarm trigger (new dependency /
unseen pattern) is not met:

- **Proxy pattern**: `opencode_models_routes.ts` / `opencode_mcp_routes.ts` already proxy the
  fork via `opencodeClient` (`this.baseUrl`, `fetch(\`${base}/...\`)`). The skills proxy is a
  third instance of the same shape.
- **End-to-end allowlist pattern**: #775 (`mcpAllowlist` -> `skillAllowlist`) is the proven
  template for fork<->api_server<->Flutter wiring; PR #776 (open) carries it.
- **Live picker data**: the sheet already consumes `AgentModelsDataSource` for live model
  data — mirror it with an `OpencodeSkillsDataSource`.
- **Re-scan primitive**: `InstanceState.invalidate` (effect/instance-state.ts:78) is the
  fork's existing cache-invalidation API (tested: "invalidates on reload"). `Skill.reload()`
  invalidates the `discovered` + `state` caches and re-scans.
- **Real-binary smoke**: `tools/release/smoke_skill_allowlist.sh` / `smoke_mcp_allowlist.sh`
  are the template for the names-alignment + no-skill-lost guards.

Anti-pattern to avoid: fixing `buildSkillsPreface` (System B) as if it were the capability
gate — it is an inert preface hint, not the serving boundary (the #765/#775 false-green).

## Clarification interview

Completed upfront via `AskUserQuestion` (the three locked decisions ARE the interview
answers): System B = materialize-on-publish; full unification this run; stack a branch off
the current #775 branch. No further ambiguity blocks decomposition.

## Issue breakdown

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
| ----- | ----- | ---- | ------------ | ------------------ | ------------ |
| 1 | Fork: `Skill.reload()` re-scan trigger + reload route | Invalidate the memoized discovery/state caches and expose a route to force a fresh disk scan | `apps/opencode_fork/.../skill/index.ts`, `.../httpapi/groups/instance.ts`, `.../httpapi/handlers/instance.ts`, `.../httpapi/api.ts` (+ fork test) | Fork unit test: write a SKILL.md after init, call reload, assert it now appears in `all()`; assert reload re-reads `skills.paths` | — |
| 2 | api_server: proxy `GET /skill` + Rhythm-managed dir write/delete + register dir | Add `GET /opencode/skills` (read, content stripped), `POST/PUT/DELETE` for managed SKILL.md, register managed dir via `config.skills.paths`, call fork reload after writes | `apps/api_server/src/routes/opencode_skills_routes.ts` (new), `controllers/opencode_skills_controller.ts` (new), `services/opencode_client_service.ts` (+`listSkills`/`reloadSkills`), `services/opencode_plugin_config.ts` (register dir), `src/app.ts` | Vitest: proxy returns fork list; write creates SKILL.md in managed dir only; path-escape attempt (`..`) rejected; delete only within managed dir; reload called after write | 1 |
| 3 | api_server: de-hardcode `agent_profile_sync` allowlist derivation | Drive/validate derived allowlists against the live `GET /skill` set; keep the agent->skills intent map but emit only names that exist live | `apps/api_server/src/services/agent_profile_sync.ts`, `services/agent_profile_scope.ts` (if shared) | Vitest: a workflow-orchestrator profile's derived allowlist subset of live skill names; a renamed engine skill drops out of the emitted list rather than persisting a dead name; fail-open preserved for unknown agents | 2 |
| 4 | Flutter: skills picker reads live + writes Rhythm-owned skills | Replace `_kAvailableSkills` with `GET /opencode/skills`; add create/edit/delete for managed skills; external skills are scope-only (read-only) | `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart` (new), `features/agents/views/_agent_profile_sheet.dart`, a small managed-skill editor widget | Widget/controller test: picker renders live names; managed skill is editable, external skill is not; save calls the write endpoint; `flutter analyze` clean | 2 |
| 5 | Flutter: MCP picker reads live (de-hardcode `_kAvailableMcps`) | Source the MCP picker from the live MCP list (`GET /opencode/mcp`) instead of the hardcoded array | `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`, `features/agents/data/*` (reuse/extend mcp data source) | Widget test: MCP picker renders live server names; `flutter analyze` clean | 4 (same file — sequence after) |
| 6 | api_server: materialize DB skills to SKILL.md on publish | On publish of a DB (System B) skill, write its SKILL.md into the managed dir and trigger reload; document DB as authoring layer | `apps/api_server/src/services/skill_materializer.ts` (new), `controllers/agentSkillsController.ts` (publish hook), `repositories/agent_skills_repository.ts` (publish state) | Vitest: publishing a DB skill writes a valid SKILL.md (frontmatter name+description) into the managed dir; it then appears via the proxy after reload | 2 |
| 7 | Names-alignment + no-skill-lost guards (test + real-binary smoke) | Lock the #775 invariant and the additive-registration invariant | `tools/release/smoke_skill_alignment.sh` (new, or extend `smoke_skill_allowlist.sh`), `apps/api_server/src/**/__tests__/*`, wire into `desktop_release.yml` | Real-binary: count/names of `GET /skill` unchanged after registering managed dir (no skill lost); a stored `allowed_skills_json` round-trips and every name exists in `GET /skill` | 1,2,3 |

## Validation plan

- **Per-issue**: `ai-workflow checks --level issue` (fork `bun test`, api_server vitest,
  `flutter analyze`).
- **PR-level**: `ai-workflow checks --level pr` + Server CI + the new alignment/no-skill-lost
  guard.
- **Manual smoke (post-merge, needs signed fork rebuild)**: open the Agent Profile sheet ->
  confirm the skills picker lists the engine's real skills; create a Rhythm-owned skill ->
  confirm it appears in the picker and the model can load it in a live session; confirm a
  scoped profile still omits out-of-scope skills (#775 still enforced).

## Data-safety notes

- No secrets, exports, or DB dumps touched. Managed dir holds only SKILL.md text.
- Write path must reject path traversal (`..`) and refuse to write outside the managed dir.
- Do not write into or relocate `~/.claude/skills` (sync-globals target).

## Known Ambiguities

- None blocking. The exact filesystem location of the Rhythm-managed dir (under the agent
  server's working dir vs. `~/.config/opencode/`) is an implementation choice for Issue 2;
  constraint is only that it must NOT collide with the sync-globals path.

## Supersedes

- Issue #777 (de-hardcode the skills picker) — this plan covers and extends it. Close #777
  as superseded when the PR opens.
