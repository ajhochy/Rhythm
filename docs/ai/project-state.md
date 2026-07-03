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
