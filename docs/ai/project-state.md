# Project State

## Recent coding-agent run — issue #1300

- Authored the disposable flag-on/flag-off live matrix, state-preserving sandbox restart, three-listener cleanup, rollout runbook, and manual shipping-client gate.
- Live-gate preparation exposed and repaired two engine wiring gaps: project prompts now carry completion IDs, and generic research synthesis can index a versioned owned project completion while ordinary generic sessions remain ignored.
- Checks: API contracts/build/typecheck, focused MCP, sandbox syntax, and Flutter analysis pass. Required live engine, socket-backed, widget, and visual checks remain blocked in this worker; `smoke-test.md` is FAIL/BLOCKED and rollout remains default-off pending AJ approval.

## Recent coding-agent run — issue #1295

- Existing schedules can target a research project; duplicate local-day ticks coalesce without altering ordinary schedule dispatch.
- Checks: #1294–#1295 contracts 12/12 and TypeScript compilation passed.

## Recent coding-agent run — issue #1296

- Added dry-run/apply historical reconciliation with deterministic grouping and preserved evidence.
- Checks: #1295–#1296 contracts 12/12 and TypeScript compilation passed.

## Recent coding-agent run — issue #1297

- Added the shipping Flutter Projects/Legacy Research UI, factual timelines, artifact tabs, warnings/budgets, and lifecycle controls.
- Formatting and analysis passed; widget execution is deferred for the known sandbox socket EPERM.

## Recent coding-agent run — issue #1298

- Added owner-scoped safe magazine rendering, deterministic HTML/Markdown exports, strict CSP, print CSS, curated provenance, and Flutter report actions.
- Checks: focused API contracts 17/17, API build, Dart formatting, and full Flutter analyze passed. Flutter widget/browser print execution is deferred to #1300 for the known socket EPERM.

## Recent coding-agent run — issue #1299

- Added frozen, cited report discussions backed by normal agent sessions, an approval-gated MCP entry, additive SQLite/Postgres Q&A linkage, and Flutter Discuss Report flow.
- Checks: API/migration 18/18, API build, MCP typecheck/security 4/4, formatting, and Flutter analyze passed. Live conversation and widget execution are deferred to #1300.

## Current focus

Live-artifact automated verification passed, but the human visual smoke **failed**: the tested native surface was a security/integration harness rather than a usable end-to-end shipping-app workflow. Existing backend, security, runtime, Dashboard tab, and same-ID agent-to-human work remains present, but it does not constitute usable completion. See `docs/ai/runs/2026-08-10-retro-live-artifact-workflow-failure.md`.

## Active branch / PR

- Branch: `feat/artifact-viewer`, pushed and tracking its remote, with `origin/main` `8a3561d9` merged.
- Draft PR: [#1338](https://github.com/ajhochy/Rhythm/pull/1338) remains **NOT READY** after failed manual smoke.
- Sharing follow-up: [#1339](https://github.com/ajhochy/Rhythm/issues/1339). Import has no issue and requires AJ approval before filing.

## In progress

- Product scope must be decided for importing existing HTML/Claude artifacts and for #1339 before implementation resumes.
- Existing unrelated follow-ups remain: on-device confirmation of #1327 subagent approvals; #1319 parent taint propagation and `rhythm_delegation_transcript`; transcript fencing for the remaining half of #1331.

## Risks / known issues

- The shipping app has no user-facing import for existing HTML/Claude artifacts, no Share dialog or collaborator management for existing artifacts, and no agent tool to update sharing after creation.
- The CI server check failed and remains separately untriaged; it is not the explanation for the product-smoke failure.
- GitNexus CLI conservatively reports **HIGH** across eight flows; all eight map to tested PCO-read or artifact-create entry points and are covered. Manager MCP reports LOW. The guarded DEBUG-only `MainFlutterWindow` registration retained its pre-impact startup-risk review and is absent from the Release binary.
- Unrelated nonblocking residual: VoiceOver traversal through offscreen dashboard rows.
- #1322 remains partial: plan mode does not make arbitrary `bash` read-only.
- Never start a bare manual `api_server` for smoke; use `tools/dev/sandbox.sh` to avoid the live engine/DB collision paths.
- The rejected demo process remains running by AJ's direction; do not manipulate it.
- `apps/api_server` still has no effective lint gate; TypeScript compilation is its static check.

## Test status

- Automated verification: **PASS** after merging `origin/main`; sanitized `ai-workflow checks --level pr` passed.
- Post-merge totals: API **4,127**, Flutter **1,129** (including **48** live-artifact), and MCP **169**; focused MCP/security **21**, AV-03 contract **11**, and real Postgres bootstrap/parity **2** passed.
- Native AV-06 A1–A10/C3–C5, secure bridge/runtime checks, Release package verification, deterministic screenshots, and the real engine/MCP → hosted API → human same-ID flow passed.
- Human visual smoke: **FAILED**; PR #1338 is not ready.

## Next step

Decide the import product scope and #1339 scope before implementation resumes. Then run an early shipping-app user-journey smoke before further hardening or any PR-readiness claim. Do not merge or deploy PR #1338.

## Recent coding-agent runs

### 2026-08-11 — issue #1290 research capability diagnostics
- Files modified: research profile seed, skill-wiring diagnostics, Config Doctor route, AgentRunner preflight, acceptance contract/tests.
- Checks run: focused #1290/profile/wiring tests pass (16 tests); Config Doctor route regression passes; API TypeScript check passes.
- Decisions made: repair only the exact shipped stale profile fingerprint; model Gmail as unavailable unless an actual Gmail MCP is connected; gate optional-channel fallback behavior behind `RHYTHM_RESEARCH_PROJECTS_ENABLED`.
- Deviations from spec: none.
- Concerns: live engine/channel status remains covered by the env-gated milestone E2E in #1300 because this worker cannot rely on socket binding.

### 2026-08-11 — issue #1291 named research projects and immutable runs
- Files modified: research repository/controller/routes, Research MCP tool group, MCP registration count guard, acceptance contract/tests.
- Checks run: #1291 contract passes (5 tests); API typecheck and focused research regressions pass; MCP registration tests and build pass.
- Decisions made: immutable run snapshots copy all mutable project configuration at creation; every child lookup rechecks owner; new routes remain 404-gated while the feature flag is off.
- Deviations from spec: none.
- Concerns: run usage is a stable zero-valued reference until factual session accounting is added by dependency-ordered issue #1294; live HTTP/MCP evidence remains assigned to #1300.

### 2026-08-11 — issue #1292 independent research pass orchestration
- Files modified: new `ResearchProjectOrchestrator`, research repository pass/run lifecycle methods, controller dispatch/recovery, server startup recovery, acceptance contract/tests.
- Checks run: #1292 contract passes (5 tests); #1291/legacy runner regressions and API typecheck pass.
- Decisions made: persist pass rows before runner invocation; coalesce in-process starts and use persisted ordinals for restart idempotency; keep pass prompts confined to the shared immutable snapshot.
- Deviations from spec: live two-pass sandbox execution is assigned to the final #1300 validation run because this worker cannot bind sockets.
- Concerns: AgentRunner exposes its session ID only on return, so the project pass link is persisted at the earliest existing engine boundary; no parallel engine/session abstraction was introduced.

### 2026-08-11 — issue #1293 contrarian review and synthesis
- Files modified: orchestrator stage prompts/lifecycle, downstream stale repository operation, acceptance contract/tests.
- Checks run: #1293 and #1292 contracts pass (10 tests); API typecheck passes.
- Decisions made: use versioned code-owned prompts; feed stages only owned-run artifact/source rows; run synthesis with explicit degraded language when pass or critic evidence is missing.
- Deviations from spec: live disagreement scenario remains in the env-gated #1300 sandbox run.
- Concerns: canonical vault artifacts are registered through the existing `rhythm_complete_research_pass` transcript/indexer contract; the short stage report remains a preview, not canonical.
# Recent coding-agent run — issue #1294

- Added factual project lifecycle progress and persisted token/cost accounting.
- Added idempotent run/pass cancellation, selective retry, restart interruption/resume, budget gating, and project events.
- Checks: #1292–#1294 contracts 16/16; `npx tsc --noEmit` passed. Live abort/restart checks deferred to #1300 isolated sandbox validation.
