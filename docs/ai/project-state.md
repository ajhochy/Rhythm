# Project State

## Current focus

The 2026-07-02 build-out is complete and parked in open PRs for review. It
delivered the Org Self-Optimizer epic (#816), token-efficiency, the life-layer,
fork-in-dev enablement, and a repointed Obsidian-vault memory system — all
verified LIVE against the real fork. Remaining work is the governance/safety
gaps the live run exposed (#856–#860), none merged.

## Active branch / PR (all open — never auto-merge)

- **#848** `codex/mega-2026-07-02` — the mega integration (~20 tracks). Server +
  Desktop + MCP CI green. Closes on merge: #817–#831, #834, #841, #842, #844,
  #845, #846, #847, #850, #851, #852, #853, #854, #855.
- **#849** — fork deferred MCP tool loading (#843); needs a signed-release smoke.
- **#836** — local Qwen via Ollama (opt-in, cloud-first).
- **#840** — earlier docs snapshot (superseded by the current docs on merge).
- Pre-existing: **#832** (optimizer plan docs), **#835** (local MCP sidecar).

## Running the fork engine in dev (IMPORTANT)

`flutter run` does NOT use the fork by default — it falls back to stock
`~/.opencode/bin/opencode` (v1.14.40, none of the scoping/skill/deferred patches).
To run the fork in dev:
1. `cd apps/opencode_fork/packages/opencode && bun install && bun run build --single`
   → `dist/opencode-darwin-arm64/bin/opencode` (`0.0.0-codex/...`).
2. `cp` it to `apps/opencode_bin/opencode` (dev discovery path) + `chmod +x`.
3. Ad-hoc sign: `codesign --force --sign - --entitlements <disable-library-validation plist> --options runtime apps/opencode_bin/opencode`.
4. Relaunch. Startup log states the engine + whether fork patches are active.
`RHYTHM_OPENCODE_BIN[_DIR]` env overrides also work (#855). `apps/opencode_bin/`
is untracked — rebuild per machine.

## Memory system (repointed + verified live)

- Agent memory lives at `~/Documents/Obsidian Vault/AGENT-MEMORY/<kind>/<slug>.md`
  (kinds: fact|person|project|preference|context). Set via
  `MEMORY_VAULT_PATH=<vault>/AGENT-MEMORY` + `MEMORY_VAULT_SUBDIR=""` (default
  `memory` for back-compat). Decision: `2026-07-02-agent-memory-in-obsidian-vault.md`.
- Injection = top-5 relevance per turn + on-demand `rhythm_search_memory`. Runs are
  NOT memory (fetched on demand via a `context` pointer → `Runs.base` /
  `Projects/<repo>/ai-runs/`). Verified live: injection, agent remember→vault+index,
  self-healing sync all work; integrity solid (no dupes/loss).

## Risks / known issues (open work, not merged)

- **#857 (CRITICAL): optimizer NOT safe unsupervised.** First live run auto-applied
  16 tighten/prune proposals on THIN history, stripping tools agents use; reverted
  by hand. Needs a minimum-observation-window guard + a revert-from-`active` path.
  **Keep the seeded optimizer cron (#830) OFF until #857 lands.**
- **#860: two parallel memory stores** — Obsidian AGENT-MEMORY vs the `memory`
  knowledge-graph MCP (`~/Documents/Claude-Memory/memory.jsonl`), both in agent
  scope. Split-brain vs single-source-of-truth.
- **#859: memory over-remember** — agents wrote 16 near-duplicate preferences in
  one session; needs write-time dedup + a consolidation pass.
- **#858: UUID-keyed agents can't chat** — session-create sends the config id, not
  `oc_agent` name → "Agent not found" (AI/Theological Researcher, Org
  Optimizer/Discovery). Data corrected; code fix open. Workaround: slug-keyed agents.
- **#856: engine caches provider creds** — Claude account switch needs an app
  restart. Quality-of-life.
- Fork binary in dev is per-machine (unsigned ad-hoc); release path unchanged.
- No `PATCH /agent-configs/:id` route — ops edits need direct SQL (noted in #858).
- 12 npm audit findings; #768 (remove cowork MCP); #814 (pin rhythm MCP version).

## Test status

- Mega branch: tsc clean; full vitest ~213 files / ~1839 pass / 1 skip;
  `smoke_org_optimizer.sh` exit 0; Flutter analyze + agent_optimizer/agent_skills
  green; Server + Desktop + MCP CI green.
- Live (fork engine, `apps/opencode_bin`): MCP scoping trims to scoped tool set
  (secretary 44 tools, not ~150K); optimizer loop wrote 16 proposals; delegation
  guardrails enforce; memory loop verified end-to-end on AGENT-MEMORY.

## Next step

1. **#857 first** — data-sufficiency guard + revert-from-active; optimizer cron stays OFF until then.
2. Review/merge PRs #848 (+#849 after a signed-release fork smoke, #836 as opt-in).
   On merge, resolve `docs/ai/project-state.md` in favor of the branch copy.
3. Memory governance: **#859** (write-time dedup + consolidation) and **#860**
   (collapse the two stores into the Obsidian vault).
4. **#858** (session-create uses `oc_agent`; sync backfills `oc_agent`) to make
   UUID-keyed agents chat-usable; consider a `PATCH /agent-configs/:id` route.
5. **#856** engine credential reload (quality-of-life).
6. Optional: hand-prune the 16 near-duplicate preferences in `AGENT-MEMORY/preference/`.

## Filed this run (2026-07-02): #854 #855 #856 #857 #858 #859 #860 (see runs/2026-07-02-mega-buildout-fork-eval-memory.md)

## Recent coding-agent runs

### 2026-07-02 — #859 memory dedup: merge-on-capture + consolidation pass + interview flow + forget-404 fix
- Files modified: `apps/api_server/src/services/memoryVaultWriteService.ts` (merge-on-capture in `rememberToVault`; exported `readNoteFull`/`resolveWithinMemoryDir`/`isoDate`/`NoteFrontmatter` for reuse; added `findMemoryRowByRememberId` for the forget-id-space fix); `apps/api_server/src/services/agentMemoryService.ts` (forget now resolves by DB-row id OR the ULID `remember()` returns; added `seedMemoryInterviewTask`); `apps/api_server/src/services/memory_similarity.ts` (new — shared Jaccard similarity + merge-content helpers); `apps/api_server/src/services/memory_consolidation_drafter.ts` (new — `runMemoryConsolidation`/`revertMemoryConsolidation`, mirrors `skill_consolidation_drafter.ts`); `apps/api_server/src/server.ts` (seed the new interview task at startup, non-fatal).
- Tests added: `memory_merge_on_capture.test.ts` (4), `memory_forget_by_remember_id.test.ts` (3), `memory_consolidation_drafter.test.ts` (3), `memory_interview_flow.test.ts` (4) — all pass. Full suite: 218 files / 1859 passed / 1 skipped (no regressions). `tsc --noEmit` clean (pre-existing baseline errors in unrelated files — missing `ws`/`resend` deps, implicit-any in project_instances/tasks repos — untouched by this change).
- Decisions made: merge-on-capture threshold set to Jaccard 0.3 (calibrated against real near-duplicate vs. distinct-memory examples: ~0.33-0.44 for genuine restatements, ~0.06-0.14 for distinct themes) — see `apps/api_server/src/services/memory_similarity.ts` doc comment. Consolidation pass shares the same threshold/scorer as merge-on-capture so the two features agree on "same theme". Memory Interview seeded `weekly` (deliberate periodic bootstrap/refresh), not `daily` (that's the passive consolidation scan).
- Deviations from spec: none — all 4 acceptance areas (A merge-on-capture, B consolidation pass, C interview flow, BUG forget-404) implemented and tested.
- Concerns: `runMemoryConsolidation` is a callable service but is NOT yet wired to a scheduled-task cron (only the seed exists for the interview flow) — the issue asked for the service + reversibility, not necessarily an always-on cron; wiring one is a natural follow-up but was deliberately left out to avoid scope creep, especially given the #857 caution about unsupervised optimizer actions. Deliberately did NOT merge across `kind` boundaries (e.g. a `fact` and a `preference` with similar wording stay separate) — this is by design per the issue's over-merge warning, not an oversight.

### 2026-07-02 — #862 memory trust: edit-in-place + explain-which-memories
- Files modified (server): `apps/api_server/src/services/memoryVaultWriteService.ts` (new `updateMemoryInVault` — vault-first edit-in-place, writes through note file + index, moves the note between kind dirs on a kind change; extended `readNoteFull` to also parse `tags`); `apps/api_server/src/services/agentMemoryService.ts` (new `update(id, patch)`, resolving `id` through both id spaces like `forget`); `apps/api_server/src/controllers/agentMemoryController.ts` (new `update` handler, `PATCH /agent-memory/:id`, returns the full updated `AgentMemory` row looked up by the new vault path — not the vault `{id,path,kind}` triple); `apps/api_server/src/routes/agentMemoryRoutes.ts` (wired the PATCH route); `apps/mcp_server/src/tools/agentMemory.ts` (new `rhythm_update_memory` tool via `apiPatch`); `apps/api_server/src/database/migrations.ts` (new `agent_session_memory_provenance` table, SQLite-only, one row per session overwritten per turn); `apps/api_server/src/repositories/agent_session_memory_provenance_repository.ts` (new — `record`/`getLatest`, caps at top-5); `apps/api_server/src/services/ws_gateway.ts` + `apps/api_server/src/services/agent_runner.ts` (both memory-injection call sites now record provenance after `buildMemoryPreface`, non-fatal); `apps/api_server/src/controllers/agent_sessions_controller.ts` + `apps/api_server/src/routes/agent_sessions_routes.ts` (new `GET /agent-sessions/:id/memory-provenance`, distinguishes `recorded:false` from an empty-but-recorded turn).
- Files modified (desktop): `apps/desktop_flutter/lib/features/agent_memory/{data,repositories,controllers,views}/*` (edit-in-place: data-source PATCH call, repository passthrough, controller `update()` replacing the entry in-place with error-on-failure, an edit icon + dialog in `agent_memory_view.dart`); `apps/desktop_flutter/lib/features/agents/{data,repositories,controllers}/agents_*.dart` (new `fetchMemoryProvenance`, wired into `selectSession`); new `apps/desktop_flutter/lib/features/agents/views/_memory_provenance_panel.dart` (mirrors `_todo_panel.dart`, wired into `_session_side_panel.dart` below the todo panel); 8 existing test fakes that `implements AgentsRepository` updated with a `fetchMemoryProvenance` stub (non-noSuchMethod fakes only — most test fakes already fall back to `noSuchMethod` and needed no change).
- Tests added: server — `memory_update_edit_in_place.test.ts` (5), `memory_update_route.test.ts` (3), `memory_provenance.test.ts` (5), `memory_provenance_route.test.ts` (4), plus 1 new case in `agentMemory_local_base.test.ts` — all pass. Full api_server suite: 222 files / 1876 passed / 1 skipped. mcp_server: 10 files / 56 passed. Flutter: new `test/features/agent_memory/agent_memory_controller_test.dart` (3 cases: persists-in-place, failure-shows-error-no-drop, delete-still-works) + full `flutter test` suite 750 passed. `flutter analyze --no-fatal-infos` and `dart format --set-exit-if-changed` both clean project-wide.
- Decisions made: provenance is ONE row per session (latest turn only, overwritten), not an append-only log — the UI only needs to explain the current/last reply, and an unbounded history would be unused write volume; this directly satisfies "provenance list viewable for a reply" without extra migration/retention complexity. `PATCH /agent-memory/:id` returns the full `AgentMemory` row (looked up by the new vault-relative path) rather than the `{id,path,kind}` triple `POST` returns, so the desktop app can refresh its view in one round-trip — this is a deliberate response-shape divergence from `create`, documented in the controller. UI wiring for "Memories used" chose the existing collapsible right-rail inspector panel pattern (`_todo_panel.dart`) over inline per-message display since provenance is session/turn-level, not per-message.
- Deviations from spec: none against the 2 acceptance areas (edit-in-place, provenance) — both implemented server + desktop, including the edit-save-failure-shows-error and no-memories-stated-clearly cases.
- Concerns: provenance keys on the LOCAL session id and only ever reflects the most recent turn — a user viewing an older assistant reply mid-transcript sees the latest turn's provenance, not that specific reply's (acceptable per the issue's "used in this reply" framing being interpreted as "most recent", but worth flagging if a future issue wants per-message provenance, which would need the richer `agent_session_messages` parts-array threading deferred here as a follow-up).

### 2026-07-02 — #860 collapse two memory stores into one (Obsidian AGENT-MEMORY is now the ONLY store)
- Files modified: `apps/api_server/src/services/opencode_client_service.ts` (new `disableStandaloneMemoryMcp()` — idempotent read-modify-write of `~/.config/opencode/opencode.json`, sets `mcp.memory.enabled=false` WITHOUT deleting the entry; never creates a memory entry, only narrows an existing one); `apps/api_server/src/server.ts` (calls it at startup, non-fatal); new `apps/api_server/src/scripts/migrate_claude_memory_to_vault.ts` (parses the knowledge-graph MCP's `memory.jsonl`, migrates each entity to one vault note via `rememberToVault` — kind mapped from entityType, person/project map directly, everything else → fact; relations become `[[wikilinks]]` under a "## Relations" section; idempotent via the existing content-key dedup + #859a merge-on-capture).
- Tests added: `opc_disable_standalone_memory_mcp.test.ts` (6 — add/no-op/never-creates/preserves-other-servers/missing-file-safe), `migrate_claude_memory_to_vault.test.ts` (9 — parse/kind-mapping/migrate/wikilinks/idempotent/missing-source-safe), `no_standalone_memory_mcp_scope.test.ts` (3 — regression guard: no `.mcp-roles/*.mcp.json`, the importer default `allowed_mcps_json`, or `CURATED_MCP_SERVERS` may ever grant a `memory` server) — all pass. Full api_server suite: 225 files / 1894 passed / 1 skipped (1 known pre-existing flaky undici-socket failure on the first run, documented in testing-guide.md, passed clean on re-run — not caused by this change). `tsc --noEmit` clean.
- **Real migration executed, not just scripted** (per this issue's explicit ask): ran `migrate_claude_memory_to_vault.ts` against the REAL `~/Documents/Claude-Memory/memory.jsonl` (23 lines: 14 entities, 10 relations) into the REAL vault at `~/Documents/Obsidian Vault/AGENT-MEMORY` (via `MEMORY_VAULT_PATH`+`MEMORY_VAULT_SUBDIR=""`) and the real local app DB (`DB_PATH=~/Library/Application Support/Rhythm/rhythm.db`). Result: 14/14 entities migrated, 0 skipped, 0 data loss — 13 notes created (one pair — the two "Due 2026-05-04 Monday" tasks, Tailscale setup + Canva design ID — merged via #859a merge-on-capture into one note with BOTH bodies preserved, verified by inspection). Vault went from 18 → 31 total notes. Re-ran the migration a second time to confirm idempotency: file count stayed at 31, no duplicate content in the merged note. `odysseus/data/memory.json` was checked and is empty (`[]`) — nothing to migrate there.
- **Real MCP-disable executed**: ran `disableStandaloneMemoryMcp()` against the REAL `~/.config/opencode/opencode.json`. Before: `mcp.memory.enabled: true` pointing at `Claude-Memory/memory.jsonl`. After: `mcp.memory.enabled: false`, every other field (command, environment, data path) preserved untouched. Re-ran to confirm idempotency: `{changed: false}`.
- Decisions made: chose disable-in-place (`enabled: false`) over deleting the `mcp.memory` config entry — preserves the user's original config in case of a future need to inspect/re-enable, and is a smaller, more reversible blast radius than a delete. Chose NOT to delete the source `~/Documents/Claude-Memory/memory.jsonl` file after migration — the migration script is additive-only by design (never touches the source), so the historical file remains as a backup; deleting user data files is out of scope for an agent-run migration. `agent_profile_sync.ts` was NOT touched — grepping `.mcp-roles/*.json`, `IMPORTER_DEFAULT_ALLOWED_MCPS_JSON`, and `CURATED_MCP_SERVERS` confirmed none of them ever granted a `"memory"` MCP server name in the first place (the split-brain risk lived entirely in the user's global opencode.json, not in Rhythm's own scope-derivation code), so the #858 minimal-touch constraint on that file was satisfied trivially — zero lines changed there.
- Deviations from spec: none — inventoried both stores (odysseus empty, Claude-Memory had 14 entities/10 relations), migrated with zero data loss, removed the standalone MCP from the live agent-facing path (disabled, not deleted), and added a regression guard proving no code-derived agent scope grants it.
- Concerns: `disableStandaloneMemoryMcp` only patches the config file — if the opencode engine already has `memory` registered live in-memory for a running session (via a prior `client.mcp.add`), a live session started before this fix would still see it until restart; this matches the existing `removeMcp`/`markMcpPresent` pattern's own caveat (config vs. live-engine state) and is not a new gap introduced here. `~/Documents/Claude-Memory/memory.jsonl` is a personal machine path outside version control — the "real migration executed" step above only ran on THIS machine (ajhochhalter's); another machine with the same jsonl file would need the same command re-run there (documented in the script's header comment).
