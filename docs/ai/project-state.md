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

### 2026-07-02 — #865 agent run QUALITY scorecard
- Files modified/added: `apps/api_server/src/services/run_quality_service.ts`
  (new — per-agent-kind rollup: completion vs escalation, token waste,
  corrections, repeated mistakes, all computed from existing
  `agent_sessions`/`agent_session_messages` tables, no new columns);
  `apps/api_server/src/routes/run_quality_routes.ts` (new — `GET
  /agents/run-quality`, mirrors `usage_budget_routes.ts`'s AGENT_LOCAL-bypass
  pattern); `apps/api_server/src/app.ts` (mounted the router under the
  `agentExecutionEnabled` gate, alongside `/agents/usage-budget`);
  `apps/api_server/src/__tests__/agent_local_auth_bypass.test.ts` (added
  `/agents/run-quality` to the shared AGENT_LOCAL regression list);
  `apps/desktop_flutter/lib/features/run_quality/**` (new feature — model,
  data source hard-coded to `AppConstants.agentLocalBaseUrl`, repository,
  controller, plain-language `RunQualityView`); `main.dart` +
  `_agents_nav_column.dart` (minimal additive wiring — one provider entry,
  one "Report Card" TOOLS row).
- Checks run: `tsc --noEmit` (api_server) — clean. `vitest run` (api_server,
  full suite) — 216 files / 1856 passed / 1 skipped. `flutter analyze
  --no-fatal-infos` — 0 errors (pre-existing infos only). `flutter test
  test/features/` — 623 passed. `dart format --set-exit-if-changed .` — 0
  changed.
- Decisions made: "token waste" is defined as tokens spent on runs that
  either ended in `status='error'` OR required 2+ user corrections without
  ever completing — a SUBSET of total spend, not a duplicate of it (an
  all-clean agent has `wastedTokens=0` despite nonzero `totalTokens`). Thin
  history: fewer than `MIN_RUNS_FOR_SIGNAL` (5) measurable (completed +
  escalated) runs sets `notEnoughData=true` and every rate field to `null`
  rather than a misleading 0%/100%. Unmeasured: a session whose `status`
  isn't a recognized terminal or live state is counted in `unmeasuredRuns`,
  never folded into completed or dropped. Repeated mistakes: `status_message`
  values are normalized (ids/numbers collapsed) and surfaced only at 2+
  occurrences. No new DB columns — everything reads existing
  `agent_sessions`/`agent_session_messages` (tokens_json, status,
  status_message, message role sequence).
- Deviations from spec: none — read-only, not wired into the org-optimizer
  auto-tune loop (#816 stays separate); no SQLite-only tables touched
  `postgres_bootstrap.ts`.
- Concerns: "user corrections" is inferred from input-role message count
  after the first per session (a proxy — no `revert`/permission-deny events
  are persisted today, so a real "did the user hit Reject/Deny" signal would
  need a new event log, out of scope here). Repeated-mistake grouping is a
  light regex normalization; may under/over-group on messages with unusual
  formatting — acceptable for a human-facing plain-language rollup, not used
  for any automated decision.
