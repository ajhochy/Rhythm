# Plan — Org Self-Optimizer Cron

**Decision doc:** `docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md`
**Status:** Plan-only (decision doc + ordered issues). Implement later.
**Branch (worktree):** `worktree-agent-a49e671f243be7300` (based on `1cef1514f`,
tip of `codex/mega-open-prs-2026-06-28`).

## Intent + Constraints

1. **Goal (one sentence):** Build a recurring, seeded agent that audits the whole
   agent org (skills, MCP servers, agent profiles, the delegation graph, recipes,
   webhook wiring) plus recent activity signals, and proposes optimizations —
   auto-applying low-risk reversible changes through a measure/revert loop and
   queuing high-risk changes for human approval.
2. **In scope:** the proposal store + lifecycle; a read-only org audit + signal
   collector; the risk-classification predicate; the low-risk auto-apply +
   measure/revert path; the human-gate review queue + Flutter review surface; six
   generators (new-agent, delegation, recipe, scope-hygiene, external-discovery,
   webhook-wiring); the seeded optimizer cron task(s); guards/smoke.
   **Out of scope:** the richer trailing-window outcome-telemetry metric
   (follow-up); production-path parity (v1 is local-only); building a web crawler
   (compose mcp-registry/npm/GitHub/WebSearch/deep-research).
3. **Hard constraints:**
   - Hybrid autonomy is **locked**: auto-apply low-risk (refine/tighten/prune),
     human-gate high-risk (create-agent, grant/expand-delegation, broaden-scope,
     create-recipe, webhook-wiring, external-adoption). Never auto-grant
     delegation, never auto-create an agent, never auto-create a webhook, never
     auto-adopt external code.
   - New tables are **local SQLite** (agent DB), not `postgres_bootstrap.ts`.
   - Every created agent/scope must pass the alignment guards + get a valid
     `.mcp-roles` role file; respect #765 / #736 / #737 / #785.
   - `dart format` + `flutter analyze --no-fatal-infos` for Flutter; api_server
     `npm run build` + vitest for TS. Contract tests per issue.
4. **Design tensions:** autonomy vs safety (resolved by the risk predicate +
   measure/revert + queue); cost vs coverage (resolved by cadence/throttle +
   per-run caps + dedup); "measure org improvement" rigor vs v1 shippability
   (resolved by per-kind metrics for revert, LLM org-score for observability only).
5. **Cheapest end-to-end proof:** proposal store + the scope-hygiene generator
   (prune-scope) auto-applying behind measure/revert — proves the whole loop with
   the lowest-risk, fully-mechanical kind, no LLM judge required.

## Clarification interview

Skipped — this is a plan-only run executing a maintainer brief in which the
contested decisions (hybrid autonomy split, all six capabilities in scope,
plan-only deliverables, local-only v1) are explicitly **LOCKED** by the
maintainer. Remaining open questions are surfaced under `## Open Questions` for
the maintainer rather than guessed.

## Prior Art (reused from this repo, not external)

The design is a deliberate clone of in-repo machinery rather than a new pattern:

- **Skill self-improvement loop** (`skill_extractor`/`skill_refiner`/`skill_apply`/
  `skill_measurement`, `agent_skills` sidecar `draft→measuring→active|reverted`,
  `agent_skill_versions` rollback) — the proposal store, lifecycle, and
  measure/revert are modeled directly on it.
- **Seeded scheduled task** (`agentMemoryService.seedConsolidationTask()` +
  `agentSchedulerService`) — the optimizer cron is a name-guarded seeded task of
  the same shape; dispatch via `AgentRunner.run`.
- **Profile sync + role files** (`agent_profile_sync.ts`, `opencode_agent_writer.ts`,
  `.mcp-roles/*.mcp.json`), **delegation** (`agent_delegation_service.ts`,
  `allowed_delegates_json`, `is_manager`, depth cap 2), **MCP guards**
  (`mcp_dispatch_guard.isToolAllowed`, `mcp_name_alignment`,
  `smoke_mcp_alignment.sh`), **cookbook** (`agent_cookbook` + Flutter
  `agent_cookbook` feature), **webhooks** (`agent_webhook_endpoints`,
  `webhookValidationService`, `agentWebhookController`, Flutter `agent_webhooks`
  feature) — reused as the generators' read/write surfaces.

Anti-pattern to avoid: a monolithic optimizer that applies changes directly with
no proposal row / no snapshot / no gate. Every change goes through a proposal row.

## Issue table

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
|---|---|---|---|---|---|
| 01 | Proposal store + lifecycle | `agent_org_proposals` table (SQLite) + repository + status state machine + dedup_key unique index | `migrations.ts`, `repositories/agent_org_proposals_repository.ts`, `models/agent_org_proposal.ts` | `agent_org_proposals_schema_contract`, repo CRUD + dedup contract | — |
| 02 | Denied-tool event log | Lightweight log of dispatch-time denied tool calls (profile, tool, count) so the audit can read them | `mcp_dispatch_guard.ts`, `migrations.ts`, new `denied_tool_events` table/repo | dispatch-guard logging contract (denied call writes a row; allowed call does not) | — |
| 03 | Read-only org audit service | `org_audit_service.ts` — snapshot of profiles/scopes/skills/recipes/delegation/webhooks + recent signals into a structured digest; no writes | `services/org_audit_service.ts`; reads `agent_configs`, `agent_skills`, `agent_cookbook`, `agent_webhook_endpoints`, `agent_sessions`, denied-tool log, live `GET /opencode/mcp` | audit-snapshot contract (shape + read-only) | 01, 02 |
| 04 | Risk-classification predicate | `classifyProposalRisk(proposal): 'low'|'high'` single source of truth; default-high; external/webhook extra flags | `services/org_proposal_risk.ts` | risk-predicate table-test: every kind maps to the documented tier; unknown→high | 01 |
| 05 | Auto-apply + measure/revert (low-risk) | Apply low-risk proposals with `before_snapshot_json`; measure via per-kind metric; keep|revert; reuse skill_measurement for skill/recipe kinds | `services/org_proposal_apply.ts`, `services/org_proposal_measure.ts`; reuse `skill_measurement.ts`/`skill_refiner.ts` | apply→measure→revert contract for prune-scope (mechanical) + refine-skill (LLM judge, injectable) | 01, 03, 04 |
| 06 | Scope-hygiene generator | Produce `tighten-scope`/`prune-scope`/`consolidate-skill` proposals from audit signals (over-broad, dead/drift via `mcp_name_alignment`, overlapping skills) | `services/generators/scope_hygiene_generator.ts` | generator contract: dead name → prune proposal; never-invoked tool → tighten; overlap → consolidate; exercised tool NOT pruned | 03, 04, 05 |
| 07 | Recipe generator | `create-recipe` (gate) + `refine-recipe` (auto) proposals from repeated prompt patterns vs `agent_cookbook` | `services/generators/recipe_generator.ts`; reuse `agent_cookbook_repository.ts` | generator contract: repeated pattern w/o recipe → create proposal (high); existing recipe improvable → refine (low) | 03, 04, 05 |
| 08 | New-agent generator | `create-agent` (gate) proposals: agent_configs row + `.mcp-roles` role file + scopes, all validated against live + alignment guards | `services/generators/new_agent_generator.ts`; reuse `agent_profile_sync.ts`, `opencode_agent_writer.ts`, `mcp_name_alignment.ts` | generator contract: proposed scopes ⊆ live; produced role file valid; apply rejected if name not live | 03, 04, 11(queue apply) |
| 09 | Delegation generator | `grant-delegation`/`expand-delegation` (gate) proposals: edits to `allowed_delegates_json`, manager-only, cycle/depth-safe | `services/generators/delegation_generator.ts`; reuse `agent_delegation_service.ts`, `agent_configs_repository.ts` | generator contract: proposal targets only valid configs; never self; respects depth cap; never auto-applied | 03, 04, 11 |
| 10 | Human-gate review queue (API) | REST endpoints to list/approve/reject proposals; approve runs the matching generator's server-side apply step | `routes/org_proposals_routes.ts`, `controllers/org_proposals_controller.ts` | queue contract: low-risk never appears as `proposed`; approve high-risk → applied; reject → rejected + dedup; external/webhook approve blocked w/o note | 01, 04, 06–09 |
| 11 | Flutter review surface | New Agents tab (alongside Cookbook/Webhooks) listing high-risk proposals w/ rationale/evidence; approve/reject; provenance & webhook-security blocks gate Approve | `apps/desktop_flutter/lib/features/agent_optimizer/...` (model/controller/data_source/view), nav wiring | widget test on the mounted surface: list renders; Approve disabled until note present; reject path | 10 |
| 12 | External discovery & adoption (gate, top risk) | Less-frequent run composing mcp-registry/npm/GitHub/WebSearch/deep-research → `external-adoption` proposals tied to a detected gap, w/ mandatory provenance note; on approve flows curated-MCP install / skill-create | `services/generators/external_discovery_generator.ts`; reuse `curated_mcp_servers.ts`/`ensureCuratedMcps`, skill-create path | generator contract: suggestion requires a gap ref; provenance_json mandatory; never auto-applied; approve → existing install path (guards still run) | 03, 04, 10, 11 |
| 13 | Webhook-wiring generator (gate, fenced) | Detect recurring inbound-trigger patterns → `webhook-wiring` proposals (trigger source/event, target agent/recipe+scope, HMAC setup, SSRF/allowlist); on approve flows the HMAC/SSRF creation path; payloads fenced (#737) | `services/generators/webhook_wiring_generator.ts`; reuse `agent_webhook_endpoints_repository.ts`, `webhookValidationService.ts`, `agentWebhookController.ts` | generator contract: proposal carries full security note; never auto-applied; approve → existing webhook-create path (HMAC/SSRF enforced); payload fencing asserted | 03, 04, 10, 11 |
| 14 | Seeded optimizer cron task(s) | `seedOrgOptimizerTask()` (daily, name-guarded) bound to a new narrowly-scoped "Org Optimizer" profile + a separate less-frequent external-discovery seeded task; per-run caps + #746 cold-start throttle | `agentMemoryService.ts` (or new `org_optimizer_seed.ts`), seed wiring at boot; new `.mcp-roles/org-optimizer.mcp.json` | seed idempotency contract (no re-seed on reboot); throttle/cap contract | 03–13 |
| 15 | Guards / smoke | Extend alignment smoke + add an org-optimizer smoke: low-risk auto path reversible; high-risk stays gated; created agent passes names⊆live; webhook/external require note | `tools/release/smoke_mcp_alignment.sh` (or new `smoke_org_optimizer.sh`), CI wiring | smoke asserts: gate invariants hold; revert restores snapshot; no auto-apply of any high-risk kind | 05–14 |

## Phased plan

- **Phase A — Foundations (01–05):** proposal store, denied-tool log, read-only
  audit, risk predicate, auto-apply+measure/revert. Ends with the cheapest
  end-to-end proof (prune-scope auto path).
- **Phase B — Internal generators (06–09):** scope-hygiene (auto-capable),
  recipe, new-agent, delegation (gated).
- **Phase C — Human gate (10–11):** review-queue API + Flutter review surface.
- **Phase D — Highest-risk gated generators (12–13):** external discovery, webhook
  wiring — both queue-only, with provenance/security notes + existing safe
  install/create paths.
- **Phase E — Cron + guards (14–15):** seed the optimizer task(s), wire throttles,
  and lock invariants with smoke.

## Known Ambiguities / Open Questions (for the maintainer)

1. **Org-improvement metric (v1):** confirm the v1 split — per-kind mechanical/body
   metrics drive auto-revert, an LLM org-goals score is observability only. Where
   should the "org stated goals" live (a checked-in config doc vs a DB row)?
2. **Cadence:** internal audit daily (e.g. 02:00) and external discovery weekly —
   confirm intervals + per-run caps (proposals/run, LLM calls/run, external
   results/run).
3. **First generator to build after the foundation:** recommend scope-hygiene
   (lowest risk, fully mechanical, proves the auto path) — confirm.
4. **Optimizer agent model:** which model/provider should the seeded optimizer run
   on (it does heavy reasoning over the org)?

## Data-safety notes

- New tables are local SQLite only; never added to `postgres_bootstrap.ts`; never
  synced to production. No user-facing app data is touched.
- The optimizer agent's `.mcp-roles` role is read-audit + write-proposals only; it
  cannot write `agent_configs` / `allowed_delegates_json` / `agent_webhook_endpoints`
  from its tool surface — privileged writes happen server-side behind the queue.
- Inbound webhook payloads are fenced (#737) before reaching any prompt.
- External adoption never auto-installs; approval flows the curated-MCP/skill paths
  so alignment guards still run.
