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

### 2026-07-02 — #858 UUID-keyed agents can't chat (worktree: 858-ocagent)
- Files modified:
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — session-create
    and resume now persist `agentKind` = `agentConfig.ocAgent` (falling back to the
    config id only when `ocAgent` is empty), instead of the raw `agent_configs.id`.
    Resume additionally calls `repo.updateAgentKind()` when the resolved name
    differs from what's stored, so a pre-fix row self-heals on next resume.
  - `apps/api_server/src/services/agent_profile_sync.ts` — added a second pass
    after the engine-agents loop that backfills `oc_agent` to `id` for every
    enabled, projectable (`isProjectableAgentConfig`) row whose `oc_agent` is
    null/empty/stale. This is the only path that reaches UUID-keyed rows the
    engine has never reported via `listAgents()`.
  - `apps/api_server/src/services/opencode_agent_writer.ts` — extracted the pure
    eligibility check (`isProjectableAgentConfig`) out of `shouldWriteAgentFile`
    so the backfill pass can call it without the test/postgres env guards that
    gate the actual file-write side effect.
  - `apps/api_server/src/routes/agents_capabilities_routes.ts` — "custom agent
    config" capability now checks the config's resolved engine name against a
    live `opencodeClient.listAgents()` snapshot (fail-open to prior
    engine-ready-only behavior when the list is unavailable), so a UUID whose
    `ocAgent` isn't actually registered no longer reports as promptable.
  - Tests: `apps/api_server/src/__tests__/agent_sessions.test.ts`,
    `apps/api_server/src/services/__tests__/agent_profile_sync.test.ts`,
    `apps/api_server/src/__tests__/agents_capabilities_routes.test.ts` — new
    `#858` cases (create/resume engine-name resolution, backfill, capabilities
    gating) plus regression cases for slug-keyed configs.
  - `PATCH /agent-configs/:id` (item 4 of the issue) was found ALREADY
    implemented and tested on this branch (`agent_configs_controller.ts`
    `.patch()`, wired in `agent_configs_routes.ts`, covered by
    `agent_configs_routes.test.ts`) — no changes needed there.
- Checks run:
  - `tsc --noEmit` — clean.
  - `vitest run` targeted files (`agent_sessions.test.ts`,
    `agents_capabilities_routes.test.ts`, `agent_profile_sync.test.ts`,
    `agent_configs_routes.test.ts`) — 100/100 pass.
  - `vitest run` full suite — 214 files, 1858 passed, 1 skipped (pre-existing), 0 failed.
- Decisions made:
  - Root-caused the bug to `AgentSelectorPill`'s per-turn `agent` field and
    `ws_gateway.ts`'s `perTurnAgent ?? wsOcAgent` precedence: both ultimately
    resolve through `agent_configs.oc_agent`, so the real defect is `oc_agent`
    being null/wrong for UUID-keyed rows, not a missing resolution step at the
    WS layer (which was already correct). Fixed at the source: session-create/
    resume now always persist the resolved engine name into `agent_kind`, and
    sync guarantees `oc_agent` converges to `id` (the name
    `opencode_agent_writer` actually registers the row's file under) for every
    projectable row, closing the gap for rows the engine-agents loop never visits.
  - Backfill runs opportunistically on every `GET /agents/capabilities`-adjacent
    `GET /agents` call (which fires `syncOpencodeAgentProfiles`) and on
    `POST /agent-configs/sync-opencode` — no new cron/migration needed.
- Deviations from spec: none — all 4 acceptance items satisfied (item 4 was
  pre-existing).
- Concerns:
  - The backfill sets `oc_agent = id` for any not-yet-synced projectable UUID
    row. This is correct once `writeAgentProfileFile` + an engine reload
    complete the round-trip, but there's a narrow window (row saved, sync ran,
    engine hasn't reloaded the `.md` file yet) where `oc_agent` optimistically
    points at a name the engine doesn't recognize YET. `/agents/capabilities`'
    live-name check (item 3) correctly reports `false` during that window, so
    the UI won't offer a broken chat — but a `session.input` frame sent to an
    already-open picker selection made just before the reload could still hit
    "Agent not found" once. Not addressed here (out of scope — no reload-wait
    mechanism existed before this fix either); flagging for a possible
    follow-up if it recurs in practice.
