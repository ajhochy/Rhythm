# EPIC: Org Self-Optimizer Cron — recurring agent-org optimizer (hybrid autonomy)

**Decision doc:** `docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md`
**Plan:** `docs/ai/plan-org-self-optimizer.md`

## Summary

A recurring, seeded agent that audits the whole agent org — skills, MCP servers,
agent profiles, the delegation graph, recipes, and webhook wiring — plus recent
session/task/delegation-outcome signals, and proposes optimizations. **Low-risk
reversible changes auto-apply through a measure→revert loop** (reusing the skill
self-improvement machinery); **high-risk changes are human-gated** via a review
queue + Flutter surface. Every change is a proposal row in a new local
`agent_org_proposals` store; nothing is applied directly.

## Output types (six capabilities)

1. New agents w/ scopes — gated
2. Delegation privileges — gated
3. Recipes (cookbook) — create gated, refine auto
4. Skill/MCP scope hygiene (tighten / prune / consolidate) — auto
5. External discovery & adoption — gated, **highest risk** (provenance-vetted)
6. Webhook wiring — gated, fenced (HMAC/SSRF + #737)

## Risk model (single source of truth: `classifyProposalRisk`, default-high)

- **LOW / auto:** refine-skill, consolidate-skill, tighten-scope, prune-scope,
  refine-recipe — reversible/narrowing, ride apply→measure→revert.
- **HIGH / gated:** create-agent, grant/expand-delegation, broaden-scope,
  create-recipe, webhook-wiring (+ fencing), external-adoption (top of the order,
  + provenance note). Never auto-applied.

## Safety invariants

Fail-closed risk; no auto agent-create / delegation-grant / scope-broaden /
webhook-create / external-adopt; created agents/scopes pass the alignment guards
+ get a valid `.mcp-roles` role file; respect #765/#736/#737/#785; the optimizer
agent's own scope is read-audit + write-proposals only (privileged writes happen
server-side behind the queue); auto path fully reversible via
`before_snapshot_json`; budget/cap + cold-start throttle (#746); dedup so the same
idea isn't re-proposed.

## Issues (dependency order)

| # | Issue | Risk surface | Depends on |
|---|---|---|---|
| 01 | Proposal store + lifecycle | foundation | — |
| 02 | Denied-tool event log | signal | — |
| 03 | Read-only org audit + signal collector | foundation | 01, 02 |
| 04 | Risk-classification predicate | foundation | 01 |
| 05 | Auto-apply + measure/revert (low-risk) | auto path | 01, 03, 04 |
| 06 | Scope-hygiene generator | auto | 03, 04, 05 |
| 07 | Recipe generator | mixed | 03, 04, 05 |
| 08 | New-agent generator | gated | 03, 04, 11 |
| 09 | Delegation generator | gated | 03, 04, 11 |
| 10 | Human-gate review queue (API) | gate | 01, 04, 06–09 |
| 11 | Flutter review surface | gate UI | 10 |
| 12 | External discovery & adoption | gated (top) | 03, 04, 10, 11 |
| 13 | Webhook-wiring generator | gated, fenced | 03, 04, 10, 11 |
| 14 | Seeded optimizer cron task(s) | wiring | 03–13 |
| 15 | Guards / smoke | regression guard | 05–14 |

**Phases:** A Foundations (01–05) · B Internal generators (06–09) · C Human gate
(10–11) · D Highest-risk gated generators (12–13) · E Cron + guards (14–15).

The cheapest end-to-end proof is 01+03+04+05+06 (prune-scope auto path: fully
mechanical, no LLM judge).

## Open questions for the maintainer

1. Org-improvement metric: confirm per-kind metrics drive auto-revert while the
   LLM org-goals score is observability only; where do "org stated goals" live?
2. Cadence: internal audit daily, external discovery weekly — confirm intervals +
   per-run caps.
3. First generator after the foundation: recommend scope-hygiene — confirm.
4. Which model should the seeded optimizer agent run on?
