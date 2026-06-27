---
index: "[[Rhythm]]"
date: 2026-06-22
repo: rhythm
branch: null
pr: null
issues: []
status: proposal
tags: [decision, rhythm]
---

# Evaluate porting Hermes Agent over OpenCode as Rhythm's engine

## Context

Rhythm embeds the OpenCode SDK as its agent engine via
`apps/api_server/src/services/opencode_client_service.ts` (~60-method adapter)
plus `opencode_engine.ts` (singleton + session-id map) and
`opencode_stream_bridge.ts` (SDK events → client frames). The question raised:
should we have ported Hermes Agent instead, and what would it take?

Investigation (2026-06-22): cloned + GitNexus-indexed the official Hermes repo
(`NousResearch/hermes-agent` @ 5937b95; 136k nodes) and three third-party
Flutter UIs. Findings:

- Hermes is a **standalone agent runtime** (Python FastAPI gateway:
  `/api/ws`, `/api/sessions`, `/api/profiles`, `/api/cron`, `/api/config`,
  skills, memory, MCP, profile-pooled backends), not an embeddable SDK. The
  official desktop is Electron+React in-monorepo, not a separate repo, not Flutter.
- Rhythm already routes every engine call through one adapter class + a narrow
  event bridge — a clean seam.
- The Flutter client is coupled to OpenCode **event shapes**, not the OpenCode
  process. An adapter that re-emits those shapes needs no client change.
- No production-quality Flutter Hermes desktop UI exists to adopt wholesale;
  `lovesmile/hermes-desktop-ui` is the best *code reference*
  (`connection_manager.dart`, `gateway_service.dart`, `local_db.dart`).

## Decision

**Recommend Option A: run Hermes as a sidecar runtime behind a new
`AgentEngine` interface, gated by `RHYTHM_AGENT_ENGINE=hermes`, with OpenCode as
the default fallback.** Do not attempt a hard SDK swap (Option C). Keep Flutter
talking to the Node `:4001` seam (defer Option B unless macOS packaging of
Hermes proves infeasible).

Prototype Phases 0–3 of `docs/dev-plans/hermes-port-plan.md` before committing.

## Alternatives considered

- **Option B (Flutter → Hermes direct):** fewer hops, uses Hermes as designed,
  but a large Flutter rewrite and loses the engine A/B seam. Fallback if
  packaging blocks Option A.
- **Option C (full OpenCode replacement):** irreversible mid-flight; discards
  working Claude/Codex routing and a tested adapter. Rejected.

## Consequences

- Gains profiles (domain isolation), durable cron, skills, memory, curated MCP —
  capabilities Rhythm lacks today.
- Costs: bundling + notarizing a Python runtime in the macOS DMG (extend
  `tools/release/sign_and_notarize_macos.sh`); supervising a second process; an
  event-translation adapter; reconciling two session models.
- No impact on production data (`api.vcrcapps.com`) or existing feature screens.
- Reversible: both engines coexist behind a flag until Phase 6.

## Artifacts

- `docs/engineering/hermes-port-architecture.md`
- `docs/dev-plans/hermes-port-plan.md`
- Analysis clones: `~/Documents/hermes-agent-desktop-analysis` (GitNexus-indexed),
  `~/Documents/hermes-flutter-ui-survey/{hermes-desktop-ui,hermes-android,hermes-wingman}`.
