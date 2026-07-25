# Current Plan — #1132 Complete fork-generated SDK

**Issue:** #1132
**Date:** 2026-07-24
**Branch:** `codex/1132-fork-sdk`

## Goal

Make Rhythm's vendored opencode fork the single generated source of truth for
the engine SDK, including Rhythm-only events and endpoints, then consume its
prebuilt package artifact from `api_server` without compiling fork source.

## Scope

### In

- Generate and export the fork-only event/type surface:
  `permission.asked`, `question.asked`, `question.replied`,
  `question.rejected`, `message.part.delta`, plus the SDK aliases currently
  supplied by the handwritten declaration.
- Make `apps/opencode_fork/packages/sdk/js` produce importable JavaScript and
  `.d.ts` files with one documented command.
- Publish that output into a committed generated package under
  `apps/api_server/vendor/`; consume it through a normal `file:` dependency.
- Delete the handwritten ambient declaration or leave only a zero-logic
  compatibility re-export.
- Replace the four raw-fetch shims with generated SDK methods:
  session MCP allowlist, session skill allowlist, skill reload, config reload.
- Add a guarded built-engine smoke covering permission, question reply/reject,
  and streamed message deltas.

### Out

- Engine runtime behavior changes.
- Replacing the established ESM/CJS dynamic-import bridge.
- Unrelated endpoint or SDK migrations.
- Starting or stopping a local API/engine server in this worktree; the
  integration coordinator owns the isolated live sandbox.

## Constraints and design tensions

- `apps/opencode_fork` remains outside the `api_server` TypeScript build.
- The generated package must install in local development, Docker builds, and
  the detached macOS app bundle. A live `file:` reference into the fork would
  fail in Docker and release packaging, so the generated artifact lives inside
  `apps/api_server/vendor/opencode-ai-sdk`.
- The generated v2 model is structurally stricter than the historical ambient
  declarations. Adapt API boundary code deliberately; do not weaken the
  generated types with a second handwritten shadow model.
- This is a medium-risk, load-bearing type migration. Contract tests must fail
  before implementation and the final live smoke must exercise the built
  engine, not mocks.

## Cheapest end-to-end proof

Build the fork SDK, install the generated vendor package into `api_server`, run
`tsc --noEmit`, prove the four methods resolve through generated client
methods, and run one isolated turn that observes streamed deltas plus both
permission and question handshakes.

## Clarification interview

Skipped. The issue has explicit scope and acceptance criteria, and the
coordinator explicitly authorized best-judgment decisions without user
interaction. The only environmental choice—who owns the sandbox process—is
already fixed: the integration coordinator owns it.

## Prior art

- The upstream v1.14.49 SDK already uses a self-contained build:
  OpenAPI generation, `@hey-api/openapi-ts` v2 generation, then `tsc` to
  `dist/`. Rhythm keeps that mechanism and adds deterministic package
  materialization rather than inventing another generator.
- The SDK publish script already rewrites source exports to `dist` exports.
  The local artifact uses the same export transformation.
- PR #1129 and
  `docs/ai/decisions/2026-07-18-ocu27-sdk-types-adoption.md` established that
  the official npm package is incomplete for Rhythm and that a blind type
  swap can false-green event handling.
- `docs/ai/decisions/2026-07-24-1132-interim-sdk-shim.md` records the interim
  ambient declaration. This change supersedes it with a generated artifact.
- A requested research swarm could not be dispatched because all agent slots
  were occupied by the issue-resolution run. Official upstream source and the
  vendored build/publish scripts were inspected directly instead.

## Implementation phases

| Phase | Work | Proof |
|---|---|---|
| 1 | Acceptance contract and red tests | Targeted tests fail for missing vendor artifact / remaining shims |
| 2 | SDK artifact build | One command emits `dist/` JS + declarations and refreshes API vendor package |
| 3 | API migration | Generated package dependency, ambient declaration removed, four typed calls |
| 4 | Behavioral smoke | Env-gated live test for built-engine permission, question reply/reject, deltas |
| 5 | Verification and handoff | fork checks, API lint/typecheck/full suite, GitNexus change audit, run log |

## Acceptance map

| Criterion | Automated evidence |
|---|---|
| Complete fork-only generated event/type surface | SDK artifact contract test imports and exercises every required event/type |
| Documented one-command artifact build | Build test verifies package exports and `.d.ts`; vendoring decision documents command |
| API imports complete generated package; no handwritten gap | API contract test resolves package and rejects ambient logic |
| API typecheck and suite | `tsc --noEmit`, lint, full Vitest |
| Four raw-fetch shims converted | Source/behavior contract plus generated-client unit coverage |
| Built-engine behavior preserved | `RHYTHM_LIVE_E2E=1` smoke against coordinator-owned sandbox |

## Risks

- Generated type names and response wrappers differ from the permissive
  handwritten facade. Mitigation: keep normalization at API boundaries and
  avoid public API changes.
- A committed generated directory can drift. Mitigation: deterministic
  generation plus a test that compares the vendor artifact to fork `dist`.
- Release/Docker omission would produce install failures. Mitigation:
  `vendor/` is copied before dependency install in both packaging paths and
  explicitly asserted in release verification.
