---
date: 2026-07-02
repo: Rhythm
branch: codex/mega-2026-07-02
pr: [848, 849, 836, 840]
issues: [816, 801, 833, 784, 817, 818, 819, 820, 821, 822, 823, 824, 825, 826, 827, 828, 829, 830, 831, 834, 841, 842, 843, 844, 845, 846, 847, 850, 851, 852, 853, 854, 855, 856, 857, 858, 859, 860]
status: in-progress (PRs open for review; live findings filed)
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# 2026-07-02 — Mega build-out, fork-in-dev, live agent eval, memory testing

Marathon session: advisor audit → built the entire Org Self-Optimizer epic +
token-efficiency + life-layer in parallel waves → discovered dev was running
STOCK opencode → built the fork and ran everything live → agent evaluation and
memory testing surfaced (and fixed) a string of real bugs, and filed the rest.

## PRs (all open — nothing merged)

- **#848** `codex/mega-2026-07-02` — the mega integration. ~20 tracks folded.
  Server + Desktop + MCP CI green. Closes (on merge): #817–#831, #834, #841,
  #842, #844, #845, #846, #847, #850, #851, #852, #853, #854, #855.
- **#849** — fork deferred MCP tool loading (#843); signed-release smoke required.
- **#836** — local Qwen via Ollama (opt-in, cloud-first).
- **#840** — earlier docs snapshot (superseded by this file on merge).
- Pre-existing: #832 (optimizer plan), #835 (local MCP sidecar).

## What shipped to the mega branch (folded + verified)

- **Org Self-Optimizer epic #816 (all 15):** proposal store (#817), denied-tool
  log (#818 + profile attribution), read-only audit (#819), risk classifier
  (#820), auto-apply/measure/revert (#821), generators — scope-hygiene (#822),
  recipe (#823), new-agent (#824), delegation (#825), external-discovery (#828),
  webhook-wiring (#829) — seeded cron + wiring (#830), safety smoke (#831).
- **Token efficiency:** tool-surface report (#841), scoped-by-default (#842),
  tiered model routing (#844), skill-effectiveness dashboard (#845).
- **Life layer:** ministry recipes (#846), research→vault entries (#847).
- **Gap-closers:** run-loop trigger tool `rhythm_run_org_optimizer` (#850),
  create-recipe apply (#851), consolidate-skill body drafting (#852),
  exercisedTools broadened to interactive sessions (#853).
- **#834** obsidian write grants (secretary + worship-planning).
- **Fixes found by running it live:** #854 (resolver reads agent_configs model),
  #855 (fork-in-dev enablement + allowlist-shape push), recipe task→agent binding
  (#846), org-optimizer NULL model + boot backfill, gmail Node PATH pin (live
  config), CI NODE_PATH for the org-optimizer smoke, MEMORY_VAULT_SUBDIR config.
- **Already-shipped discovery:** memory-vault epic #801 (#802–#808) had merged in
  #812 — re-verified and closed. #833/#784 closed.

## Fork now runs in dev (was silently STOCK opencode 1.14.40)

Root cause found via the agent eval: dev (`flutter run`) fell back to stock
`~/.opencode/bin/opencode` because no bundled fork exists in dev — so NONE of the
scoping/skill/deferred patches were active. Built the fork
(`bun run build --single` → `0.0.0-codex/mega-2026-07-02-…`, arm64), placed at
`apps/opencode_bin/opencode` (dev discovery path), ad-hoc signed with
disable-library-validation. Startup log now states the engine + whether fork
patches are active. Verified LIVE: MCP scoping trims the surface (secretary = 44
scoped tools, not the ~150K catalog); optimizer loop runs end-to-end
(`rhythm_run_org_optimizer` wrote 16 proposals); delegation guardrails enforce.

## Live findings filed (open — future work)

- **#854** resolver ignored agent_configs model → custom agents stalled. FIXED on branch.
- **#855** dev ran stock opencode + allowlist pushed wrong shape → 150K surface / Gemini 400. FIXED on branch.
- **#856** engine caches provider creds → Claude account switch needs app restart (OAuth write alone doesn't reload). OPEN.
- **#857 (CRITICAL)** optimizer over-pruned on THIN history: first live run auto-applied 16 tighten/prune proposals stripping tools agents use (secretary→[], workflow-orchestrator→[]). Manually reverted (restored scopes from snapshots; set reverted). Generator needs a minimum-observation-window guard; also no supported revert-from-`active`. OPEN — **optimizer cron (#830) must stay OFF until this lands.**
- **#858** UUID-keyed agents (AI/Theological Researcher, Org Optimizer/Discovery) can't be chat-prompted: session-create sends the engine the config id, not `oc_agent` name → "Agent not found". Corrected the researchers' `oc_agent` data + deleted a TEST agent; the code fix is OPEN. Workaround: use slug-keyed agents.
- **#859** memory write-hygiene + consolidation: agents over-remember (16 near-dup preferences in one session); need write-time dedup + a consolidation pass. OPEN.
- **#860** two parallel memory stores: Obsidian AGENT-MEMORY vs the `memory` knowledge-graph MCP (`~/Documents/Claude-Memory/memory.jsonl`) both in agent scope — split-brain vs single-source-of-truth. OPEN.

## Memory system: repointed to Obsidian + tested live

- **Repointed** agent memory from the dedicated `~/Documents/Memory-Vault` into
  `~/Documents/Obsidian Vault/AGENT-MEMORY` with a clean `<kind>/<slug>.md`
  layout (added `MEMORY_VAULT_SUBDIR`; default `memory` for back-compat, set ``
  for the clean layout). Scanner reads the path recursively, so it stays scoped
  to AGENT-MEMORY (never the whole vault). Moved the 3 existing memories.
- **Verified LIVE with secretary:** relevance injection (top-5 cap working),
  agent-driven `remember` → clean vault note + index row, self-healing sync.
  Integrity solid throughout (21 notes ↔ 21 index rows, no dupes; large sync
  `deleted=N` were orphan reconciliation, not data loss).
- Added a `context` navigation-pointer memory so agents fetch dev-project runs
  ON DEMAND (via obsidian tools → `Runs.base` / `Projects/<repo>/ai-runs/`)
  rather than bulk-injecting them. Confirmed you already have the human-facing
  index: `Home` → `Maps/Dev Projects MOC` → `![[Runs.base]]` + `![[Command Center.base]]`.
- Weakness exposed → #859/#860 (over-remember + two stores). Infra is sound;
  governance (what-to-remember + single store) is the gap.

## Checks

- Per-track verification gates + CI green through all folds (final mega suite
  ~213 files / ~1839 vitest pass; org-optimizer safety smoke exit 0; Flutter
  analyze + agent_optimizer/agent_skills tests green).
- Live: fork engine confirmed, scoping/loop/delegation verified, memory loop
  verified end-to-end on the new AGENT-MEMORY vault.

## Notes / decisions

- Intent (2026-07-02): one vault w/ folders (memory now under Obsidian
  AGENT-MEMORY), #801+#816 parallel (801 was already done), local models
  nice-to-have, full-autonomy-with-rollback for the optimizer.
- Parallel worktree Sonnet coding agents, contract-first, folded sequentially
  with checks between — the proven mega pattern.
- Manual data repairs done directly on the live SQLite DB (scope revert, oc_agent
  correction, TEST delete) because there is no `PATCH /agent-configs/:id` route —
  worth adding (noted in #858).
