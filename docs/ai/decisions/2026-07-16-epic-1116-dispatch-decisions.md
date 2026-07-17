---
tags: [decision, rhythm]
date: 2026-07-16
epic: 1116
---

# Epic #1116 mega-PR — dispatch & scope decisions

## Context

Orchestrating one mega-PR resolving epic #1116 (Self-Improvement Engine) and its
14 children. Planning (Opus) produced `docs/ai/current-plan.md` with 6
disjoint-ownership worktree clusters and 6 open questions requiring a call before
dispatch. User directive: run autonomously after upfront alignment; one mega PR;
e2e each issue against a live sandboxed server (local `api_server`, `AGENT_LOCAL=true`,
isolated temp DB); worktrees for concurrency; planning=Opus, impl/testing=Sonnet;
trigger release build after user merges.

## Decisions

1. **#1113 Postgres parity — live proof.** Docker is available, so the Postgres
   side is verified for real: spawn `api_server` with `DB_CLIENT=postgres` against a
   disposable Docker Postgres, boot → seed → gap write→read→resolve. Not a
   documented-manual step. `postgres_bootstrap.ts` ALTER/backfill built regardless.

2. **#1115 — stopgap.** Raise the undici POST timeout (client + server) well above
   the longest observed pass (≥600s), mirroring the proven #1039/#1040 override.
   Not the heavier fire-and-return (runId + status endpoint). Ponytail: smallest
   correct change; async contract deferred to a follow-up if ever needed.

3. **#1055 — build in Wave 1.** Owns its `source` field contract (fixture/unit
   verifiable now); the live "org badge appears" smoke runs post-integration after
   #1054 wires the index.

4. **#1114 — `RHYTHM_MCP_REGISTRY_SEARCH_URL` (plain HTTP) is the source.** The
   `mcp-registry` OAuth connector is unreachable headless. e2e runs against a local
   stub registry returning one candidate. Prod registry URL is per-env deploy config,
   not hardcoded.

5. **#1053 — public reads, authed writes (as designed).** `GET /org-skills/index.json`
   + file serving are unauthenticated by design (the engine fetches them via
   `skills.urls`); writes require JWT. Implementation adds a test asserting NO secret
   fields appear in the payload and a "org skills must contain no secrets" note in the
   route file. **Flagged for user security review at PR time** — this is a new public
   prod endpoint.

6. **#1067 — include.** User listed it. Implement the SDK/OpenAPI regen + fork
   `bun test`; it is inert until #1068 (OCU-27, out of scope) adopts the typed SDK, and
   ships on the release-build fork rebuild (which the orchestrator triggers post-merge).
   **Flagged in PR** as inert-until-#1068 so the reviewer knows it changes no runtime
   behavior in this release.

## Execution shape

- **Wave 1 (4 concurrent worktrees):** A (harvest cost + discovery, sequential sub-agents),
  C (#1055 Flutter), D (#1067 fork), E (#1090 Flutter). Mutually disjoint files.
- **Wave 2 (2 concurrent worktrees, after A integrates):** B (#1053→#1054∥#1056 org library),
  F (#1115 optimizer timeout). Both share append-seam files with A → land A first, rebase.
- Per-issue: TDD (behavior/e2e test red → implement → green) folds the acceptance-contract
  step into the coding agent at 14-issue scale; verification-gate + live sandbox e2e before
  any "resolved" claim.

## Consequences

- #1113's live-Postgres proof adds a Docker dependency to the verification pass (available now).
- #1067 adds fork-rebuild scope to the release build but zero runtime delta this release.
- #1053 opens a public prod endpoint — mitigated by the no-secrets test + PR security flag.
- All decisions are reversible pre-merge: the PR + manual merge is the human gate.
