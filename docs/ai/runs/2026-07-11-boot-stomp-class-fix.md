---
date: 2026-07-11
repo: Rhythm
branch: fix/boot-stomp-config-revert-class
pr: TBD (draft, stacked on #1080)
issues: ["#1039-family", "#916", "#923", "#889"]
status: implemented — full suite green, live 3-boot proof 16/16
tags: [run, Rhythm]
---

# Boot-stomp class fix — "my Config Doctor re-specs are gone on the next boot"

One architectural fix for the whole class of silent config reverts, with a
structural regression guard. Root cause across every instance: **a one-time
seed/repair coded as eternal enforcement** — a write that fires on every
boot/sync cycle against a field a user or agent can also edit live.

## Root-cause taxonomy (all confirmed by 4-agent sweep + direct reads)

### Trigger T1 — every boot (`runMigrations()` runs on EVERY SQLite boot; `runPostgresBootstrap` likewise)

| # | Site (pre-fix) | Stomped value | Guard (pre-fix) | User experience |
|---|---|---|---|---|
| 1 | migrations.ts:1875 | config-doctor `system_prompt` + `core_permissions_json` | none | **The headline complaint** — any Config Doctor re-spec reverted on restart |
| 2 | migrations.ts:1979 | org-optimizer `allowed_mcps_json` | `IS NOT NULL` (fires every boot once set) | MCP scope edits reverted on restart |
| 3 | migrations.ts:2106 | Theological-Researcher `core_permissions_json` | none | Permission edits reverted on restart |
| 4 | migrations.ts:1986 | ANY profile's `allowed_mcps_json`/`allowed_skills_json` = `[]` → NULL | value == `'[]'` | **Security-relevant**: deliberate deny-all silently widened to unrestricted every boot |
| 5 | migrations.ts:1807 + postgres_bootstrap.ts:815 | worship-planning/theologian `allowed_delegates_json` → NULL | non-manager + non-null | Delegate grants to non-manager profiles wiped every boot (both DB engines) |
| 6 | migrations.ts:937 / :970 | gemini-cli / opencode preset fields + `updated_at` churn | none | CLI preset edits reverted; row churned every boot |
| 7 | migrations.ts:2047-2076 | 5 profiles' MCP scope (tool-rename transform) | converging transform | Re-adding a renamed tool/'calendar' server re-transformed every boot |
| 8 | migrations.ts:2112 | research `allowed_skills_json` (skill prune) | converging filter | Re-granting searxng-search/domain-intel/parallel-cli removed every boot |
| 9 | migrations.ts:2139 / :2148 | worship-production + title/compaction/summary models | "repair" disjuncts incl. `LIKE '%opus%'` | Deliberate model choices (e.g. opus) reverted every boot |
| 10 | 4 task seeds (agentMemoryService, sundayPrepService, ministry_recipes_seed, org_optimizer_seed) | user-DELETED seeded scheduled tasks | row-existence by name | Deleted seeded task resurrected on every boot |

### Trigger T2 — every picker refresh (`syncOpencodeAgentProfiles`, fired on every `GET /agent-sessions/agents`)

| # | Site (pre-fix) | Stomped value | User experience |
|---|---|---|---|
| 11 | agent_profile_sync.ts update patch | `session_selectable` recomputed from engine mode + forced for 7 front-door/CLI agents | #1039 (fixed in PR #1080 for mode:'all'); remaining: promotions/demotions of the 7 forced agents reverted on every picker refresh |
| 12 | secretary_delegation_seed.ts:168 | secretary `allowed_delegates_json` reconciled to `.mcp-roles/secretary.mcp.json` whenever different | Secretary roster edits in designer reverted on next picker refresh |

### Audited and CLEAN (no fix needed)
- **Skills**: SKILL.md file is sole source of truth; DB→file materializer retired (#977); all boot writers write-if-absent/run-once; sync backfills `allowed_skills_json` only when null.
- **MCP roles**: `.mcp-roles/*.json` written once per new agent, never regenerated; expander/scope services are pure readers; mcp-auth.json merge-preserving.
- **Scheduled task definitions**: scheduler writes run-metadata only; org-optimizer `refine-task` is hard-classified high-risk (human-gated).
- **Memory vault / credentials / opencode.json**: single clear authority, write-through or change-gated.
- **#1002** (effectiveCwd) verified fixed at agent_runner.ts:714/:950/:989/:1106.

### Known-and-accepted (by design, documented)
- Org-optimizer daily auto-prune of MCP/skill scope (narrowing-only, snapshot+measure/revert) — intentional autonomy.
- Prod-task mirror refreshes title/notes/dates of non-done mirrored tasks from prod every 10 min (prod is authority; status protected).
- Self-improvement loop may replace a skill body with a higher-scoring revision (snapshot + auto-revert on no-improvement) — the product's purpose.

## The architectural fix (one rule, one mechanism, one guard)

**Rule:** the DB row is the single authority for user-editable config. After
first insert, recurring jobs may only: (a) create-if-absent, (b) backfill
NULL, (c) repair with a durable one-time `schema_meta` marker, or (d) project
DB → derived artifact. Nothing recomputes a user-editable field on a cycle.

**Mechanism:** `runOnce(key, fn)` in migrations.ts (generalizes the existing
`backfill_scheduled_date_v1` marker pattern) — 15 content repairs wrapped;
same marker pattern in postgres_bootstrap.ts; `seed_once.ts`
(seedMarkerExists/recordSeedMarker) gives task seeds delete-tombstones and
the secretary reconcile one-time semantics; agent_profile_sync stops writing
`session_selectable` on existing rows (insert-only, including the front-door
force); new `hide_cli_presets_v1` one-time repair replaces the sync-side
eternal CLI hiding; agentSchedulesController guard exempts preset rows.

**Structural guard:** `migrations_replay_guard.test.ts` — customizes every
user-editable field on every agent_configs row (incl. rows shaped like every
historical stomp target + adversarial values: opus models, '[]' deny-all,
non-manager delegates), re-runs runMigrations twice, asserts the ENTIRE DB is
unchanged. Any future unguarded content write to ANY table fails it.
Negative control: run against pre-fix migrations.ts → fails (verified).

## Files
- apps/api_server/src/database/migrations.ts — runOnce + 16 wraps + contract doc
- apps/api_server/src/database/postgres_bootstrap.ts — marker-guarded wipe
- apps/api_server/src/services/agent_profile_sync.ts — session_selectable insert-only
- apps/api_server/src/services/secretary_delegation_seed.ts — one-time reconcile
- apps/api_server/src/services/seed_once.ts — NEW marker helper
- apps/api_server/src/services/{agentMemoryService,sundayPrepService,ministry_recipes_seed,org_optimizer_seed}.ts — delete-tombstones
- apps/api_server/src/controllers/agentSchedulesController.ts — preset exemption in #1039 guard
- Tests: migrations_replay_guard.test.ts (NEW), seed_once_tombstone.test.ts (NEW), + updated agent_configs / agent_profile_sync(_hygiene) / secretary_delegation_seed tests

## Checks
- `tsc` clean; vitest **2702 passed / 0 failed** (26 pre-existing skips)
- Live 3-boot proof (real server, scratch DB + isolated HOME): **16/16 PASS** —
  Config Doctor prompt/perms/scope, sync-shaped Theological-Researcher perms,
  API-created profile, and a deleted seeded task all survived two restarts
- Negative control: replay guard fails against pre-fix migrations.ts

## Notes / behavior changes to be aware of
- **Reviewed decision (code-review finding, adjudicated):** runOnce markers are
  consumed even when the target row doesn't exist yet, so on a FRESH install
  the historical repairs for sync-imported rows (worship-production /
  Theological-Researcher / research / title / compaction / summary /
  org-optimizer) never apply retroactively — by design: those blocks repair
  pre-existing installs' drift; fresh installs get defaults from the insert
  paths (profile sync tier resolution, role files). Do NOT gate markers on
  rowcount — an armed state-shaped repair (the '[]'→NULL normalization) would
  re-widen a future deliberate deny-all, resurrecting the bug class.
- Repairs now apply exactly once per install; to ship a new default prompt or
  preset revision, add a `runOnce` with a bumped key (documented at top of
  runMigrations).
- CLI preset rows (build/codex/gemini-cli/opencode) are hidden from the picker
  by a one-time repair; a user can now deliberately promote them and it sticks.
- Scheduling a bare CLI kind is no longer blocked by the delegation guard
  (preset rows were incorrectly treated as delegation-only subagents in live
  DBs — latent bug fixed).
- Deleted seeded tasks stay deleted. To re-seed intentionally, delete the
  `seeded_task:<name>` row from schema_meta.
