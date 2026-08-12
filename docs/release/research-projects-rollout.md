---
date: 2026-08-11
status: gated
tags: [release, research-projects]
---

# Research Projects rollout

Research Projects remains default-off through `RHYTHM_RESEARCH_PROJECTS_ENABLED=false`. AJ must give explicit approval for a named pilot cohort after every automated and manual gate below passes. There is no automatic enablement, migration-triggered enablement, or unattended expansion of the cohort.

## Preflight and evidence

Run the isolated `research_projects_live_e2e.test.ts` matrix, the separate flag-off live regression, API/MCP/Flutter suites, SQLite/Postgres schema-parity contracts, and the manual desktop print flow. Attach the exact source SHA, commands, terminal output, sandbox log, and `smoke-test.md` to the rollout decision. `/health` must report the intended flag state and `/opencode/health` must be ready.

The copied-data reconciliation gate must record dry-run/apply/repeated-apply counts and a byte-for-byte vault digest before and after reconciliation. It must never rerun historical agents.

## Pilot metrics

Review at least daily during the pilot:

- project completion, degraded, error, cancellation, retry, resume, and budget-block rates;
- per-pass and whole-run p50/p95 latency, distinct session-ID count, token totals, and cost per run;
- curated-source capture completeness, archive failures, canonical artifact rate, and magazine/export failures or CSP reports;
- scheduler same-day duplicate rate and restart recovery loss;
- grounded Q&A citation rate, explicit missing-evidence admissions, and frozen-context violations;
- ownership/path/XSS denials and the legacy research success rate.

Pilot thresholds are: no security/integrity event; at least 90% terminal success excluding deliberate cancel/budget probes; p95 under 30 minutes; canonical artifact and source-capture rates at least 95%; no unexpected run over its frozen budget; and median cost within the limit AJ approved for the cohort.

## Abort conditions

Disable the pilot immediately for any cross-owner disclosure or ownership leak, traversal or script execution, wrong/multiple canonical artifact, reconciliation vault mutation, budget overrun, duplicate same-day schedule run, restart data loss, credential/prompt disclosure, or loss of legacy research behavior. Also abort when a quantitative pilot threshold is missed twice consecutively. Preserve evidence and project data; do not repair production rows destructively.

## Disable and recovery

1. Set `RHYTHM_RESEARCH_PROJECTS_ENABLED=false` and restart the API through the normal deployment process. The flag is read at startup.
2. Confirm `/health.features.researchProjectsEnabled` is `false`, authenticated project routes return concealed 404s, and legacy `/agent-research` still completes.
3. Stop or cancel in-flight AgentRunner sessions explicitly when containment requires it: changing the flag alone does not abort work already started by the old process.
4. Preserve all project, run, source, artifact, and discussion rows for diagnosis. Do not delete vault content or run reconciliation as cleanup.
5. On a repaired build, repeat the complete flag-off and flag-on gates. Startup recovery may then resume interrupted unfinished work without rerunning completed passes.
6. Re-enable only after AJ gives a new explicit approval.

## Known limitations

- The isolated sandbox proves SQLite runtime behavior; Postgres is covered by bootstrap/migration parity tests unless an ephemeral Postgres gate is explicitly supplied.
- Provider availability, web-source changes, model latency, and price changes can make the live gate slow or flaky; diagnostics must identify the provider/model without exposing credentials.
- Browser-native Print / Save as PDF and Flutter external-app launching require a human desktop smoke.
- The feature flag is startup-static and does not itself stop sessions already running in another process.
