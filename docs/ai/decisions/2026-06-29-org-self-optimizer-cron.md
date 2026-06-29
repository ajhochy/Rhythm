---
date: 2026-06-29
repo: Rhythm
tags: [decision, rhythm, api_server, agents, optimizer, epic]
index: "[[Rhythm]]"
status: Design / Epic (plan-only — no feature code this run)
---

# Org Self-Optimizer Cron — recurring agent-org optimizer with hybrid autonomy

> **Status: DESIGN NOTE / EPIC. No feature code this run.** This documents the
> recommended architecture, the risk-classification predicate, the
> measure/revert design, the proposal store + review-queue model, and the
> safety invariants. Implementation is decomposed into ordered issues under
> `docs/ai/generated-issues/org-optimizer-*.md`.

## Context

Rhythm now carries an integrated agent org: agent profiles (`agent_configs`
with per-profile MCP / skill / delegate scopes + `.mcp-roles/<slug>.mcp.json`
role files), a curated MCP catalog, a manager→specialist delegation tool, a
cookbook of recipes (`agent_cookbook`), a daily seeded scheduler
(`agentSchedulerService` + `agentMemoryService.seedConsolidationTask()`),
inbound webhook endpoints (`agent_webhook_endpoints` + `webhookValidationService`,
HMAC-SHA256 + SSRF-safe), and a **fully working skill self-improvement loop**
(`skill_extractor` → `skill_refiner` → `skill_apply` → `skill_measurement`, with
an `agent_skills` sidecar lifecycle `draft → measuring → active|reverted` and a
versioned `agent_skill_versions` rollback ledger).

Each of these is optimized *ad hoc* by humans. There is no recurring process
that reads the org as a whole — skills, MCP servers, agent profiles, the
delegation graph, recipes, webhook wiring, plus recent
session/task/delegation-outcome signals — and proposes optimizations. The
maintainer wants a recurring **set-up / org self-optimizer cron** that
continuously does this across six capabilities:

1. **New agents** to build, each with the right MCP + skill scopes.
2. **Delegation privileges** (the manager→specialist graph).
3. **Recipes** (cookbook entries).
4. **Skill / MCP scope hygiene** (prune dead scopes, fix drift, consolidate
   overlapping skills).
5. **External discovery & adoption** — scout external sources (mcp-registry,
   npm, GitHub, web) for new/popular skills + MCP servers + APIs that fill a
   **detected** org gap, and propose adoptions for human vetting.
6. **Webhook wiring** — detect recurring inbound-trigger patterns and propose
   wiring an inbound webhook → agent/recipe to automate that trigger.

This is **mostly compose, not build-new**: the scheduler is a seeded task, the
proposal/measure/revert machinery mirrors the skill loop, and the generators
read/write existing tables and reuse existing guards (alignment guards, the
curated-MCP install path, the skill-create path, and the
HMAC/SSRF webhook-creation path).

## Decision

### 1. Architecture (compose the existing substrate)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Org Self-Optimizer  =  a SEEDED scheduled task (agent_scheduled_tasks) │
│   seeded idempotently like seedConsolidationTask() (name-guard)        │
│   bound to a NEW, narrowly-scoped agent profile: "Org Optimizer"       │
│   (a SECOND, less-frequent seeded task drives external discovery)      │
└───────────────┬─────────────────────────────────────────────────────┘
                │ scheduler dispatches → AgentRunner.run(prompt, scope)
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ OPTIMIZER AGENT RUN (LLM)                                              │
│  1. READ the org via a read-only audit snapshot (org_audit_service)    │
│  2. COLLECT signals (see §4) into a structured digest                  │
│  3. PROPOSE changes → write rows to `agent_org_proposals`              │
│       (deduped against seen/applied/rejected set)                      │
│  4. CLASSIFY each proposal low-risk(auto) vs high-risk(gate) (§2)      │
│  5. For LOW-RISK: apply → measure → keep|revert  (§3, reuses skill loop)│
│     For HIGH-RISK: leave in review queue (status='proposed')           │
└───────────────┬─────────────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
  AUTO PATH          HUMAN-GATE QUEUE
  (low-risk only)    (high-risk: new agent, grant/broaden delegation,
   measure→revert     broaden scope, recipe-create, EXTERNAL ADOPTION,
   on regression)     WEBHOOK WIRING)
                      → Flutter review surface: approve/reject
                      → on approve: run the SAME generator's apply step
```

Key reuse:

- **Cron / seeding:** a new `seedOrgOptimizerTask()` mirroring
  `agentMemoryService.seedConsolidationTask()` — name-guarded
  (`listAllAsync().some(t => t.name === 'Org Self-Optimizer')`), `scheduleType`
  daily/cron, narrow `allowedMcpsJson` + `allowedSkillsJson`. Dispatch is the
  unchanged `AgentRunner.run` local path (`AGENT_LOCAL=true`).
- **Proposal store + lifecycle + measure/revert:** a new `agent_org_proposals`
  table whose lifecycle and revert mechanics are modeled on `agent_skills`
  (`status` state machine + a `before_snapshot_json` rollback payload that plays
  the role of `agent_skill_versions` + `base_version`).
- **Generators** read/write existing surfaces only: `agent_configs` +
  `.mcp-roles` (new agent), `allowed_delegates_json` (delegation), `agent_cookbook`
  (recipe), `allowed_mcps_json` / `allowed_skills_json` + alignment guards (scope
  hygiene), curated-MCP install + skill-create paths (external adoption),
  `agent_webhook_endpoints` via the HMAC/SSRF creation path (webhook wiring).

### 2. Risk classification — single source-of-truth predicate

A **single exported predicate** `classifyProposalRisk(proposal): 'low' | 'high'`
is the only place risk is decided. Both the auto path and the queue read it.
Default is **high** (fail-closed): anything not explicitly enumerated low-risk is
gated.

| Risk tier (low→high) | Class | Action verbs | Path |
|---|---|---|---|
| **LOW (auto)** | reversible, narrowing, non-privilege | `refine-skill`, `consolidate-skill`, `tighten-scope` (remove a tool/server from an over-broad allowlist), `prune-scope` (drop a dead/never-invoked scope), `refine-recipe` | auto-apply → measure → revert-on-regression |
| **HIGH (gate)** | privilege-granting / expanding | `create-agent`, `grant-delegation`, `expand-delegation`, `broaden-scope` (add a tool/server), `create-recipe` | review queue; applied only on explicit human approval |
| **HIGH (gate) — privileged inbound surface** | runs an agent on external input | **`webhook-wiring`** (create an inbound endpoint that fires an agent/recipe) | review queue + payload fencing (#737) + HMAC/SSRF |
| **HIGH (gate) — TOP of risk order** | runs third-party code with scopes | **`external-adoption`** (adopt an MCP server / skill / API) | review queue + mandatory provenance/security note |

**Hard rules baked into the predicate:**

- **Never auto-grant or auto-expand delegation.** Any write to
  `allowed_delegates_json` is HIGH.
- **Never auto-create an agent.** Any `agent_configs` INSERT is HIGH.
- **Never broaden a scope automatically.** "Add to allowlist" is HIGH;
  "remove from allowlist" is LOW. Tighten/prune narrow the blast radius and are
  reversible from the snapshot.
- **Never auto-create an inbound webhook endpoint.** Creating an endpoint that
  runs an agent on external input is an injection surface → HIGH, gated, fenced.
- **Never auto-adopt external code.** External adoption is the single highest
  risk class.
- **Never broaden a USER-authored scope, even on the gate path, without consent.**
  Profile sync (#785) preserves user overlays; the optimizer must treat any
  user-edited `allowed_*` field as immutable input unless a human approves the
  specific change.

Two HIGH proposal kinds carry extra gate conditions the queue UI enforces before
the Approve button is enabled:

- `external-adoption` → `external=1`; requires the provenance/security note
  (`provenance_json`) to be present and shown.
- `webhook-wiring` → requires the security note (trigger source/event, target
  agent/recipe + scope, HMAC secret setup, SSRF/allowlist constraints, the
  payload-fencing confirmation).

### 3. Measuring an org change (the auto path's revert decision)

The skill loop measures one skill's body against a fixed rubric (0–100) and
keeps iff `post > baseline`. An org change has no single body, so v1 defines a
**per-proposal-kind metric** and reuses the same strictly-greater keep rule with
fail-closed revert:

- **`tighten-scope` / `prune-scope`:** mechanical + cheap, no LLM needed for the
  keep decision. Capture before/after **scope-hygiene metrics** (count of
  dead/never-invoked scope entries; count of denied-tool events for the affected
  profile over the trailing window). Keep iff hygiene strictly improves AND a
  **functional guard** passes: the affected profile's recent successfully-used
  tools/servers remain in the allowlist (never prune a scope that was actually
  exercised). Revert otherwise.
- **`refine-skill` / `consolidate-skill` / `refine-recipe`:** reuse
  `skill_refiner.scoreSkillBody` / `skill_measurement.measureAppliedSkill` LLM
  judge directly (refine-skill literally *is* the existing path). For recipe
  refinement, score the recipe body against its stated purpose with the same
  bounded scorer; keep iff strictly greater.
- **Org-level "did it improve?" (LLM judge, for the audit's own summary):** an
  LLM judge scores the post-run org snapshot against the **org's stated goals**
  (a small, human-editable goals config) + before/after hygiene metrics,
  producing a run-level score recorded on the audit row. This is
  **observability for the human**, not the auto-revert trigger — the per-kind
  metrics above drive revert. (Rationale: an org-wide LLM score is too noisy to
  gate an automatic revert on.)

**Follow-up (flagged, not v1):** a richer **outcome-telemetry** metric — measure
whether the change actually reduced denied-tool events / failed delegations /
re-proposals over the *next* N runs, and auto-revert on a trailing-window
regression. v1 measures at apply time; the follow-up measures over time.

Revert mechanics mirror `skill_measurement`: every auto-apply first writes
`before_snapshot_json` (the exact prior value of the field/file it will change);
revert replays that snapshot and sets `status='reverted'`, and the dedup guard
blocks re-proposing the same reverted change.

### 4. Signals that drive proposals (where each is read from)

| Proposal it justifies | Concrete signal | Source |
|---|---|---|
| **create-agent** | A recurring cluster of similar tasks/sessions with no well-fitting profile; repeated denied-tool events implying a missing specialist | `agent_scheduled_tasks`, `agent_sessions` (+ messages), denied-tool log |
| **grant/expand-delegation** | A manager repeatedly does work a specialist profile already covers, or fails/abandons a sub-task it could have delegated | `agent_sessions` of `is_manager` profiles; `agent_delegation_service` outcomes |
| **create/refine-recipe** | A repeated multi-step prompt pattern across sessions with no matching `agent_cookbook` entry, or a recipe that consistently precedes failures | `agent_sessions` messages; `agent_cookbook` |
| **tighten-scope** | A profile granted a tool/server it never invokes over the trailing window (over-broad) | tool-use telemetry vs `allowed_mcps_json`/`allowed_skills_json` |
| **prune-scope** | An `allowed_*` name that no longer matches any live engine id (dead/drift) — exactly what the alignment guards flag | `mcp_name_alignment` unresolved names, live `GET /opencode/mcp` + `listSkills()` |
| **consolidate-skill** | Two+ `agent_skills` with high title/description overlap (duplicate procedures) | `agent_skills` + relevance scoring (reuse `skill_refiner` matcher) |
| **webhook-wiring** | A recurring inbound-trigger pattern: a kind of email/API payload/manual paste that repeatedly kicks off the same agent/task, with no `agent_webhook_endpoints` row wiring it | `agent_sessions` (trigger provenance), `claude_triggers`, `agent_webhook_endpoints` (gap = not yet wired) |
| **external-adoption** | A **detected** gap from any of the above (recurring task with no good tool, missing capability, repeated denied-tool) that no internal change can fill | the gap rows from this same audit (tie each suggestion to a gap id) |

**Denied-tool / blocked-call signal:** `mcp_dispatch_guard.isToolAllowed`
currently returns a boolean at dispatch; v1 adds a lightweight **denied-tool
event log** so the audit can read "profile X was denied tool Y N times" — the
strongest signal for both broaden-scope (gate) and create-agent. This logging is
its own issue and a dependency of the signal collector.

### 5. Proposal store + review queue

**New table `agent_org_proposals`** (local SQLite — the agent DB; **not** in
`postgres_bootstrap.ts`, matching `agent_skills` / `agent_scheduled_tasks` /
`agent_webhook_endpoints`, all SQLite-only). Columns mirror the `agent_skills`
sidecar discipline:

```sql
CREATE TABLE IF NOT EXISTS agent_org_proposals (
  id            TEXT PRIMARY KEY,
  audit_run_id  TEXT,                 -- groups proposals from one optimizer run
  kind          TEXT NOT NULL,        -- create-agent|grant-delegation|expand-delegation|
                                      -- broaden-scope|tighten-scope|prune-scope|
                                      -- create-recipe|refine-recipe|refine-skill|
                                      -- consolidate-skill|external-adoption|webhook-wiring
  risk          TEXT NOT NULL,        -- 'low' | 'high'  (from classifyProposalRisk)
  external      INTEGER DEFAULT 0,    -- 1 for external-adoption (extra vetting gate)
  status        TEXT NOT NULL DEFAULT 'proposed',
                                      -- proposed|approved|rejected|applied|measuring|active|reverted
  title         TEXT NOT NULL,
  rationale     TEXT,                 -- human-readable why + the signal it cites
  signal_ref    TEXT,                 -- pointer/JSON to the evidence (gap id, session ids, counts)
  target_ref    TEXT,                 -- what it touches (agent_config_id, skill name, recipe id, server id)
  change_json   TEXT,                 -- the proposed change payload (apply input)
  before_snapshot_json TEXT,          -- rollback payload captured at apply time
  provenance_json TEXT,               -- external-adoption: source/stars/downloads/last-updated/
                                      -- maintainer/license/install-cmd ; webhook-wiring: security note
  dedup_key     TEXT,                 -- stable hash for idempotency (kind+target+change)
  baseline_score INTEGER,
  post_score     INTEGER,
  measure_reason TEXT,
  decided_by_user_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_proposals_status ON agent_org_proposals(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_proposals_dedup ON agent_org_proposals(dedup_key);
```

**Lifecycle:**

```
                       ┌──────────── classifyProposalRisk ───────────┐
        proposed ──────┤ low  → applied → measuring → active|reverted │ (auto)
                       │ high → (queue) → approved → applied → ...     │
                       │              └→ rejected                      │ (human)
                       └──────────────────────────────────────────────┘
```

- LOW-risk proposals never sit in `proposed`; the auto path advances them
  immediately (apply → measuring → active|reverted).
- HIGH-risk proposals stop at `proposed` and surface in the **Flutter review
  surface** (a new tab in the Agents UI alongside Cookbook + Webhooks): list with
  kind / risk / rationale / evidence; for `external=1` or `webhook-wiring`, the
  security/provenance block is shown and the **Approve button is disabled until
  the human has the note**. Approve → server runs the matching generator's apply
  step (the same code the auto path would run, but only after human consent) →
  `applied`/`measuring`. Reject → `rejected` (feeds dedup so it isn't
  re-proposed).
- **Idempotency:** `dedup_key` (UNIQUE) is a stable hash over
  `kind + target_ref + normalized change`. Before inserting, the optimizer checks
  the seen set (`proposed|approved|applied|active|reverted|rejected`) and skips
  duplicates — so the same idea is not re-proposed every run.

### 6. External discovery & adoption — highest risk class, propose-only

- **Strictly human-gated, never auto-applied.** Adopting a third-party MCP
  server or skill = running external code with scopes; it sits **above**
  create-agent / grant-delegation / webhook-wiring in the risk order. Always
  `risk='high'`, `external=1`, always in the review queue, never on the auto path.
- **Compose existing sources; do NOT build a crawler.** The optimizer's external
  pass is a separate, less-frequent run that invokes: the connected
  **`mcp-registry` MCP** (`search_mcp_registry`, `suggest_connectors`,
  `list_connectors`), the **npm registry**, **GitHub** (trending / topics for MCP
  servers + skills + awesome-lists), and **`WebSearch`** / the **`deep-research`**
  skill. These are agent-side MCP/skill calls scoped to the external-discovery
  profile — not new server code.
- **Tie every suggestion to a detected gap.** A suggestion is only written if it
  references a concrete audit gap (`signal_ref` → gap id). "Trending/popular with
  no matching gap" is dropped.
- **Provenance/maintenance/security note is mandatory** (`provenance_json`):
  source, stars/downloads, last-updated, maintainer, license, install command.
  The review UI blocks approval until present + seen.
- **On approval, flow through the existing safe paths:** an approved MCP adoption
  runs the curated-MCP install path (`ensureCuratedMcps` / opencode.json mcp
  block) and then must pass the alignment guards; an approved skill adoption runs
  the skill-create path. No bespoke install code that bypasses the guards.
- **Cost/cadence:** external search is expensive + noisy → throttle it (its own
  schedule, **less frequent** than the internal audit, e.g. weekly), dedup against
  the already-suggested/rejected set, and cap results per run.

### 7. Webhook wiring — high-risk, gated, fenced

- **Human-gated (high-risk class).** Creating an inbound endpoint that RUNS AN
  AGENT on external input is powerful and an injection surface. Never
  auto-create; always in the review queue with a security note.
- **What the proposal must specify:** the trigger source/event, the target
  agent/recipe + its scope, the HMAC secret setup, and SSRF/allowlist
  constraints. These are stored in `change_json` + the security note in
  `provenance_json`.
- **Untrusted-content fencing (#737):** inbound payloads are fenced before they
  reach an agent prompt — the generated wiring must route the payload through the
  same fencing the inbound webhook drain uses, never inlining raw external text
  into the prompt unbounded.
- **On approval, flow through the existing webhook-endpoint creation path**
  (`agentWebhookController` / `webhookValidationService`) so HMAC-SHA256
  verification + SSRF-safe validation are not bypassed. Substrate to reuse:
  `agent_webhook_endpoints` table (`event_types_json`, `secret`,
  `target_scheduled_task_id`, `target_prompt`, `enabled`, `trigger_count`),
  `webhookValidationService.ts`, `agentWebhookController.ts`, and the Flutter
  Agents → Webhooks UI (`apps/desktop_flutter/lib/features/agent_webhooks/`).
- **No auto path.** There is no measure/revert for webhook-wiring — it is queue
  only.

### 8. Safety invariants (must hold for the whole epic)

1. **Default-high risk; fail-closed.** Unknown/ambiguous proposal kind → gated.
2. **No auto agent-creation, no auto delegation grant/expand, no auto
   scope-broaden, no auto webhook-creation, no auto external-adoption.** These are
   HIGH by predicate and only ever applied after explicit human approval.
3. **Every created agent/scope passes the existing alignment guards**
   (`smoke_mcp_alignment.sh`: configured ⊆ live; per-session allowlist
   round-trips; names ⊆ live via `mcp_name_alignment`) and gets a **valid
   `.mcp-roles/<slug>.mcp.json` role file**. A proposal whose apply would produce
   a name not in the live set is rejected at apply time.
4. **Respect #765 / #736 / #737 enforcement** — scoping is enforced at
   advertise-time (Layer 1) and dispatch-time (`isToolAllowed`, Layer 2); inbound
   webhook payloads are fenced (#737). The optimizer never weakens these;
   tighten/prune only narrow.
5. **Never broaden a user-authored scope without consent** (#785 overlay
   preservation). User-edited `allowed_*` fields are immutable input.
6. **The optimizer's own agent is itself scoped and human-gated where it grants
   privileges.** It is powerful (it analyzes config) — it gets a narrow
   `.mcp-roles` role (read-audit + write-proposals only). It cannot itself write
   `agent_configs` / `allowed_delegates_json` / `agent_webhook_endpoints` — those
   writes happen in the server-side apply step behind the queue, not from the
   agent's tool surface.
7. **Auto path is fully reversible.** Every auto-apply captures
   `before_snapshot_json` first; regression → revert.
8. **Budget / iteration cap + cold-start throttle** (reuse the #746 90s engine
   cold-start guard; cap proposals-per-run and LLM calls-per-run; external pass is
   separately throttled and result-capped).

## Alternatives considered

- **One monolithic optimizer service (no proposal store).** Rejected: no human
  gate, no audit trail, no revert. The proposal store + lifecycle is the whole
  point of safe autonomy.
- **Auto-apply everything behind measure/revert (no human gate for
  agent/delegation/webhook/external).** Rejected by maintainer decision —
  privilege grants, inbound surfaces, and external code are not safely
  auto-revertible (they can act before the next measure).
- **Org-wide LLM score as the auto-revert trigger.** Rejected for v1 — too noisy;
  per-kind mechanical/body metrics gate revert, the org LLM score is observability
  only.
- **Build a crawler for external discovery.** Rejected by maintainer requirement —
  compose mcp-registry / npm / GitHub / WebSearch / deep-research instead.
- **New Postgres tables for proposals.** Rejected — the agent DB is local SQLite
  (matches `agent_skills` / `agent_scheduled_tasks` / `agent_webhook_endpoints`);
  proposals are local-only and never synced to production.

## Consequences

- A new local table `agent_org_proposals`, a read-only `org_audit_service`, a
  denied-tool event log, one risk-predicate module, four internal generators +
  one external-discovery module + one webhook-wiring generator, a seeded optimizer
  task (and a less-frequent external task), and a Flutter review surface.
- The skill loop's machinery is reused, not duplicated, for the refine-skill /
  consolidate-skill kinds and the measure/revert discipline. The curated-MCP
  install, skill-create, and HMAC/SSRF webhook-create paths are reused for the
  three highest-risk generators.
- The org optimizer can run unattended for low-risk hygiene while every
  privilege-granting, inbound-surface, or external change waits for a human — the
  maintainer's hybrid autonomy intent.
- Follow-ups: richer outcome-telemetry metric (trailing-window revert); production
  path parity (the optimizer is local-only in v1, matching the scheduled-task
  decision's local-only scope).
