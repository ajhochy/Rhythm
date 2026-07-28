# Rhythm Agent iOS Roadmap Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Rhythm Agents iOS prototype: authenticated Rhythm account access, secure pairing to one Mac over Tailscale, agent chats and activity, dedicated agent-tool screens, broad approved OpenCode parity, and a signed physical-device/TestFlight build.

**Architecture:** Keep the provider-centric Expo app inside the Rhythm monorepo at `apps/mobile` and add two explicit transports: `RhythmCloudClient` for the production API and `PairedMacClient` for a narrow authenticated gateway on the local Rhythm API server. Preserve current canonical ownership: production-owned account/integration data comes from Rhythm Cloud; engine, filesystem, memory-vault, and execution data comes from the paired Mac, with read-only mobile caching so a sleeping Mac does not create a global app failure. The gateway validates a revocable device token, resolves a Rhythm-registered project server-side, and proxies only an explicit OpenCode/API allowlist.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, Expo Router, Expo SecureStore, Rhythm Express/TypeScript API, SQLite for local device/engine records, Postgres for existing production records, Tailscale Serve, EAS Build, Vitest, Node contract tests, Playwright.

## Global Constraints

- iOS first; Android implementation and Android-specific acceptance testing are excluded.
- Rhythm bundles OpenCode `1.14.49`; the mobile client remains pinned to its generated contract.
- Use the existing EAS project `bd873c89-2fe2-45db-805c-ab819e582e5c` through `/Users/aj/.local/bin/rhythm-mobile-eas` only.
- Never read, print, log, copy into chat, or commit Expo, Apple, Rhythm, Google, pairing, or device credentials.
- The prototype uses tailnet-only HTTPS through Tailscale Serve; never expose the OpenCode port directly.
- One active paired Mac per Rhythm user in the first release; data types retain explicit host/device IDs.
- Local filesystem operations accept a Rhythm project ID, never a caller-supplied arbitrary root.
- Cloud and paired-Mac failures remain independent; cached local data is read-only while the Mac is offline.
- Destructive operations require explicit confirmation and all screens include loading, empty, offline, forbidden, expired-auth, and server-error states.
- Backend behavior requires a gated live test against the real API server and bundled OpenCode engine plus a `docs/ai/runs/` record.
- Work only on feature branches/worktrees. Do not merge or push to `main` without AJ's explicit approval.

---

## Delivery order

The roadmap is executed as independently reviewable vertical slices. Tasks 1–3 finish the existing foundation branch. Tasks 4–8 create the secure paired-host path. Tasks 9–15 build product surfaces. Tasks 16–18 close parity and release gates.

## Repository ownership decision — 2026-07-24

Rhythm Agents mobile is a Rhythm product, not an upstream contribution. The
adapted Expo fork is owned and shipped from `apps/mobile` in the Rhythm
monorepo. Any `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/...`
paths below describe the source worktree used before consolidation; for all
remaining implementation, map the relative path into `apps/mobile/...` in the
Rhythm repository. Do not open or merge a PR in the separate opencode-mobile
repository.

## Execution status — automated implementation complete through the human release boundary 2026-07-25

**Current state:** Tasks 1–16 are implemented in the Rhythm monorepo. Task 17's
automated implementation, current-head regression gates, focused independent
audits, final in-process review, source push/CI, and durable evidence are
complete; the immutable whole-branch human review and merge decision remain.
Task 18 has green
rebuilt-engine coverage on both dedicated alternate ports and the exact
`4098/4097` plan ports, but remains intentionally open for Apple signing, a
registered physical iPhone, subjective acceptance, production build, and
TestFlight. Nothing has been merged into `main`; PR #1165 remains draft.

**Active worktree and PR:**

- `/Users/ajhochhalter/Documents/rhythm-worktrees/run0724-mobile-1172`
- local branch `codex/mobile-1172-agents-activity`
- remote PR branch `feat/rhythm-agent-ios-roadmap`
- draft PR #1165
- tested source `8701432480f585fe90119cbaee66382d062da879`

**Review and live status:**

- Whole-branch review found two Important creative-path trust defects:
  cross-session install approval reuse and a model-controlled Gallery path
  override. Both are corrected. The final security pass also replaced an
  environment bearer that was visible through same-user process inspection
  with an engine-held Ed25519 proof, and removed request-time public-key
  re-pinning.
- Corrective iOS 18.3 iPhone SE simulator smoke in dark appearance at maximum
  Dynamic Type passes for the Agents/Activity heading and Webhooks card
  actions.
- The rebuilt API/engine/mobile-gateway matrix passes on dedicated isolated
  ports and on the exact `4098/4097` plan ports without changing the installed
  desktop listeners on `4001/4096`.

The task-by-task closure ledger is
`docs/superpowers/plans/2026-07-24-rhythm-agent-ios-ledger.md`; exact commands
and evidence are recorded in
`docs/ai/runs/2026-07-25-mobile-roadmap-finalization.md`.

### Task 1: Foundation verification and contract baseline

**Files:**
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/package.json`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/scripts/rhythm-opencode-contract.mjs`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/rhythm-opencode-contract.test.mjs`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/README.md`

**Interfaces:**
- Consumes: `contracts/rhythm-opencode-contract.json`, bundled OpenAPI fingerprint.
- Produces: `npm run verify:foundation`, a single reproducible foundation gate.

- [x] Add a failing script assertion that `verify:foundation` is present and runs contract check, lint, typecheck, focused security tests, fake-server self-test, and web E2E.
- [x] Run `node tests/app-config.test.mjs` and confirm the new assertion fails because the script is absent.
- [x] Add `"verify:foundation": "npm run contract:check && npm run lint && npm run typecheck && npm run test:connection-persistence && npm run test:notification-persistence && npm run test:fake-server:self && npm run test:e2e:web"`.
- [x] Run `npm run verify:foundation`; fix only branch-caused failures.
- [x] Record exact commands and results in the README verification section.

### Task 2: Stable cloud and paired-Mac transport contracts

**Files:**
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/lib/transport/api-error.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/lib/transport/rhythm-cloud-client.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/lib/transport/paired-mac-client.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/lib/transport/types.ts`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/transport-clients.test.mjs`

**Interfaces:**
- Produces: `ApiError { source, status, code, message, retryable }`, `RhythmCloudClient.request<T>()`, `PairedMacClient.request<T>()`, `subscribe()`, and `ptyUrl()`.

- [x] Write failing tests proving cloud bearer tokens and paired-device tokens use different headers/stores, JSON errors normalize to `ApiError`, and no token appears in thrown messages.
- [x] Run `node tests/transport-clients.test.mjs`; expect module-not-found failure.
- [x] Implement the two clients over native `fetch`; accept base URL/token providers by dependency injection and redact authorization material before constructing errors.
- [x] Implement paired-host SSE URL construction and PTY `https:`→`wss:` conversion without opening a connection.
- [x] Run the focused test, lint, and typecheck.

### Task 3: Rhythm mobile account shell

**Files:**
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/lib/auth/rhythm-session-store.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/rhythm-account-provider.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/components/settings/rhythm-account-section.tsx`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/_layout.tsx`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/(tabs)/settings.tsx`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/rhythm-account.test.mjs`

**Interfaces:**
- Consumes: `POST /auth/google/mobile-exchange`, `GET /auth/me`, `POST /auth/logout`.
- Produces: `useRhythmAccount(): { state, user, signIn, signOut, refresh }` with tokens stored under `rhythm.cloud.session` in SecureStore.

- [x] Write failing tests for successful token exchange, invalid/expired token clearing, logout, and secret-free persisted metadata.
- [x] Run the focused test and confirm failure.
- [x] Implement session persistence with Expo SecureStore and a provider state machine: `signedOut | signingIn | signedIn | refreshing | expired | offline`.
- [x] Wire the existing production mobile-exchange flow and show account state in Settings; do not duplicate profile/tool configuration there.
- [x] Run focused tests, lint, typecheck, and app-config tests.

### Task 4: Pairing and device-token persistence on the Mac

**Files:**
- Create: `apps/api_server/src/repositories/mobile_devices_repository.ts`
- Create: `apps/api_server/src/services/mobile_pairing_service.ts`
- Create: `apps/api_server/src/controllers/mobile_gateway_controller.ts`
- Create: `apps/api_server/src/routes/mobile_gateway_routes.ts`
- Modify: `apps/api_server/src/app.ts`
- Modify: `apps/api_server/src/db/database.ts`
- Modify: `apps/api_server/src/db/postgres_bootstrap.ts`
- Test: `apps/api_server/src/services/__tests__/mobile_pairing_service.test.ts`

**Interfaces:**
- Produces: `POST /mobile-gateway/pairing-codes`, `POST /mobile-gateway/pair`, `GET /mobile-gateway/devices`, `DELETE /mobile-gateway/devices/:id`, `GET /mobile-gateway/health`.
- Pair response: `{ deviceId, hostId, deviceToken, gatewayVersion, rhythmVersion, opencodeVersion, contractFingerprint, features, minimumMobileVersion }`.

- [x] Run GitNexus upstream impact analysis for `createApp` and database bootstrap symbols; stop and report before editing if risk is HIGH/CRITICAL.
- [x] Write failing tests for one-time use, expiry, user mismatch, token hashing, one-active-host replacement, and revocation.
- [x] Implement SQLite tables `mobile_pairing_codes` and `mobile_devices`; add additive Postgres bootstrap definitions even though pairing remains local-only, preventing schema drift in shared repository code.
- [x] Generate 32-byte random codes/tokens with `crypto.randomBytes`; persist only SHA-256 verifiers and constant-time compare presented values.
- [x] Mount the router inside `agentExecutionEnabled`, ensure logs redact secrets, then run focused tests and API build.

### Task 5: Mobile gateway authentication and project allowlist

**Files:**
- Create: `apps/api_server/src/middleware/mobile_device_auth.ts`
- Create: `apps/api_server/src/services/mobile_project_scope.ts`
- Modify: `apps/api_server/src/routes/mobile_gateway_routes.ts`
- Test: `apps/api_server/src/services/__tests__/mobile_project_scope.test.ts`
- Live test: `apps/api_server/src/services/__tests__/mobile_gateway_scope_live.test.ts`

**Interfaces:**
- Produces: `requireMobileDevice`, `resolveMobileProject(projectId): { id, root }`.
- Request contract: `Authorization: Device <token>` and `X-Rhythm-Project-ID: <registered project id>`.

- [x] Write failing tests rejecting missing/revoked tokens, arbitrary roots, unknown projects, sibling-prefix tricks, `..`, symlink escape, and user mismatch.
- [x] Run focused tests and confirm failures.
- [x] Implement authorization before project lookup; resolve roots only through Rhythm's projects repository and `realpath` containment checks.
- [x] Add a gated live test that creates a disposable project, pairs, accesses it, and proves traversal and unregistered roots fail.
- [x] Run API typecheck/unit tests; defer the live run until the rebuilt real backend is available in Task 18.

### Task 6: Allowlisted HTTP proxy and compatibility report

**Files:**
- Create: `apps/api_server/src/services/mobile_opencode_proxy.ts`
- Modify: `apps/api_server/src/routes/mobile_gateway_routes.ts`
- Test: `apps/api_server/src/services/__tests__/mobile_opencode_proxy.test.ts`
- Live test: `apps/api_server/src/services/__tests__/mobile_opencode_proxy_live.test.ts`

**Interfaces:**
- Produces: `/mobile-gateway/opencode/*` for explicitly classified operations only.
- Allowlist source: generated operation IDs from `apps/opencode_fork/packages/sdk/openapi.json` plus Rhythm route adapters; methods outside the set return `403 OPERATION_NOT_ALLOWED`.

- [x] Write failing table tests for all approved operation IDs and explicit rejection tests for `global.dispose`, `global.upgrade`, instance disposal, TUI, v2, workspace/sync, and experimental Console families.
- [x] Implement method/path matching from a static generated manifest, inject the server-resolved project directory, strip caller roots, and cap request/response bodies.
- [x] Return a stable compatibility payload containing versions, fingerprint, feature IDs, and minimum mobile version.
- [x] Add a gated real-engine test for health, session list/create, file read, and a rejected upgrade request.
- [x] Run focused unit tests and API build.

### Task 7: SSE and PTY WebSocket gateway

**Files:**
- Create: `apps/api_server/src/services/mobile_sse_proxy.ts`
- Create: `apps/api_server/src/services/mobile_pty_proxy.ts`
- Modify: `apps/api_server/src/routes/mobile_gateway_routes.ts`
- Modify: `apps/api_server/src/server.ts`
- Test: `apps/api_server/src/services/__tests__/mobile_realtime_proxy.test.ts`
- Live test: `apps/api_server/src/services/__tests__/mobile_realtime_proxy_live.test.ts`

**Interfaces:**
- Produces: `GET /mobile-gateway/events`, `GET /mobile-gateway/sessions/:id/events`, `GET /mobile-gateway/pty/:id/connect`.

- [x] Impact-analyze the HTTP server upgrade handler and existing PTY bridge before edits.
- [x] Write failing tests for authentication before upgrade, close propagation, heartbeat forwarding, reconnect, revoked-token rejection, and binary/text PTY frames.
- [x] Implement streaming proxies with abort cleanup, bounded buffers, no payload logging, and existing OpenCode connect-ticket semantics.
- [x] Add gated live tests that observe one real SSE session event and one PTY input/output round trip.
- [x] Run focused tests, API build, and existing PTY/SSE suites.

### Task 8: Desktop Enable Mobile Access and Tailscale orchestration

**Files:**
- Create: `apps/api_server/src/services/tailscale_serve_service.ts`
- Create: `apps/desktop_flutter/lib/features/agents/data/mobile_access_data_source.dart`
- Create: `apps/desktop_flutter/lib/features/agents/views/mobile_access_dialog.dart`
- Modify: `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
- Test: `apps/api_server/src/services/__tests__/tailscale_serve_service.test.ts`
- Test: `apps/desktop_flutter/test/features/agents/mobile_access_dialog_test.dart`

**Interfaces:**
- Produces desktop flow: health check → validate/configure Serve → create code → display QR containing `{ gatewayUrl, pairingCode }`.

- [x] Impact-analyze the Agents settings/action entry point before editing.
- [x] Write failing service tests using injected `tailscale` command execution; cover not-installed, logged-out, wrong Serve target, success, and secret-free errors.
- [x] Implement idempotent `tailscale serve --bg https+insecure://localhost:4001` orchestration using argument arrays, never a shell string.
- [x] Add Flutter tests for diagnostics, QR expiry, regenerate, revoke, and one-active-host replacement warning.
- [x] Run API checks plus required Dart format, Flutter analyze, and focused Flutter tests.

### Task 9: iOS pairing, compatibility, and independent connection states

**Files:**
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/lib/pairing/paired-host-store.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/paired-host-provider.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/components/settings/paired-mac-section.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/pair.tsx`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/_layout.tsx`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/paired-host.test.mjs`

**Interfaces:**
- Produces: `usePairedHost(): { state, host, pair, revoke, refresh }`; token stored in SecureStore, metadata in AsyncStorage.

- [x] Write failing tests for QR parsing, user mismatch, version incompatibility, revoked token, offline host retention, and token redaction.
- [x] Implement pairing state `unpaired | pairing | connected | offline | tailscaleUnavailable | revoked | incompatible | unhealthy` independently from cloud auth.
- [x] Hide/disable unsupported features from the server feature list and present actionable diagnostics.
- [x] Wire Settings and pair route; do not expose raw token/code after success.
- [x] Run focused tests, lint, typecheck, and web E2E pairing scenarios.

### Task 10: Three-tab information architecture and reusable tool shell

**Files:**
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/(tabs)/_layout.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/(tabs)/agents.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/(tabs)/tools.tsx`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/(tabs)/settings.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/components/tools/tool-screen-state.tsx`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/e2e/rhythm-navigation.spec.mjs`

**Interfaces:**
- Produces primary tabs `Agents`, `Tools`, `Settings`; terminal/workspace become contextual Agent routes.

- [x] Write failing E2E assertions for exactly three tabs and navigation to Chats, Activity, every approved Tool, and Settings diagnostics.
- [x] Replace the old four-tab labels/routes while preserving existing chat/workspace/terminal components behind nested Agents routes.
- [x] Add `ToolScreenState` variants for loading, empty, offline-cache, expired-auth, forbidden, and retryable server error.
- [x] Verify accessibility labels, Dynamic Type-safe layouts, dark mode, and destructive confirmation patterns.
- [x] Run lint, typecheck, and navigation E2E.

### Task 11: Chats, project grouping, child sessions, and recovery

**Files:**
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/agent-chat-provider.tsx`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/session-service.ts`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/components/chat/chat-view.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/components/chat/chat-list.tsx`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/e2e/rhythm-chats.spec.mjs`

**Interfaces:**
- Produces all/project-filtered chats, active/completed/archived filters, nested child sessions, and authoritative refresh after SSE reconnect.

- [x] Write failing E2E flows for create/open/rename/archive/restore/fork/delete, project filtering, children, approvals/questions, reconnect dedupe, and Mac-offline cached list.
- [x] Reuse existing transcript, permission, question, diff, todo, usage, file, and terminal components; do not duplicate their state in screens.
- [x] Add stable-ID event dedupe and on-reconnect transcript/status refresh with bounded exponential backoff.
- [x] Persist only secret-free read models for offline display; disable mutations while offline.
- [x] Run fake-server self-test, chat E2E, lint, and typecheck.

### Task 12: Unified execution Activity feed

**Files:**
- Create: `apps/api_server/src/controllers/agent_activity_controller.ts`
- Create: `apps/api_server/src/routes/agent_activity_routes.ts`
- Create: `apps/api_server/src/services/agent_activity_service.ts`
- Modify: `apps/api_server/src/app.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/activity-service.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/components/agents/activity-feed.tsx`
- Test: `apps/api_server/src/services/__tests__/agent_activity_service.test.ts`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/e2e/rhythm-activity.spec.mjs`

**Interfaces:**
- Produces `GET /agent-activity?source=&profileId=&projectId=&status=&cursor=` returning `{ items, nextCursor }` from sessions, scheduler, webhooks, research, cookbook, and optimizer records.

- [x] Impact-analyze repositories used by the aggregate before editing.
- [x] Write failing tests for canonical ordering, source/status normalization, cursor stability, and no duplicate execution.
- [x] Implement a read-only aggregation service; do not create a second execution table.
- [x] Render active/waiting/failed/completed states and deep-link to transcript/result when present.
- [x] Run API tests/build and mobile Activity E2E.

### Task 13: Brain, Research, Scheduled Jobs, and Webhooks

**Files:**
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/rhythm-tools-service.ts`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/brain.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/research.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/schedules.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/webhooks.tsx`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/e2e/rhythm-tools-core.spec.mjs`

**Interfaces:**
- Consumes paired-Mac routes `/agent-memory`, `/agent-research`, `/agent-schedules`, `/agent-webhooks` through `PairedMacClient`.

- [x] Write failing service contract tests for list/detail/create/edit/delete/search, research progress, schedule enable/run-now, and webhook create/revoke/copy URL.
- [x] Implement typed service methods and focused screens using `ToolScreenState` and existing server validation messages.
- [x] Store secret-free read caches only; webhook secrets may be shown once and copied but never persisted.
- [x] Require confirmations for memory/webhook deletion and schedule run-now.
- [x] Run core-tools E2E, lint, and typecheck.

### Task 14: Profiles, Cookbook, Review Queue, and Report Card

**Files:**
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/profiles.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/cookbook.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/review-queue.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/report-card.tsx`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/rhythm-tools-service.ts`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/e2e/rhythm-tools-admin.spec.mjs`

**Interfaces:**
- Consumes `/agent-configs`, `/agent-delegation`, `/agent-cookbook`, `/agent-org-proposals`, `/agents/run-quality`.

- [x] Write failing flows for profile prompt/model/scope/delegation edits, recipe CRUD/run, proposal approve/reject details, and report-card summaries.
- [x] Implement typed service methods; preserve null-versus-empty permission-scope semantics.
- [x] Show local projection status for profile edits and refresh only after server confirmation.
- [x] Require confirmation for profile/recipe deletion and high-risk proposal approval.
- [x] Run admin-tools E2E, lint, and typecheck.

### Task 15: Email, Gallery, Skills, Playbooks, MCP, and models

**Files:**
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/email.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/gallery.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/skills.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/playbooks.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/mcp.tsx`
- Create: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/app/tools/models.tsx`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/rhythm-tools-service.ts`
- Test: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/e2e/rhythm-tools-integrations.spec.mjs`

**Interfaces:**
- Cloud: Gmail signals and Canva-backed designs through authenticated production routes.
- Paired Mac: `/opencode/skills`, `/opencode/commands`, `/opencode/mcp`, `/opencode/models`, `/opencode/auth`.

- [x] Write failing tests proving cloud Email/Gallery remain available when the Mac is offline while paired-host tools show cached read-only state.
- [x] Implement Email and Gallery with least-privilege summaries; never persist full email bodies or OAuth credentials.
- [x] Implement Skills metadata/history/availability, Playbook CRUD, MCP lifecycle/OAuth, and provider/model diagnostics by reusing existing provider services.
- [x] Add compatibility-feature gating and destructive confirmations.
- [x] Run integration-tools E2E, lint, typecheck, and provider tests.

### Task 16: Approved OpenCode parity completion

**Files:**
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/workspace-service.ts`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/session-service.ts`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/providers/services/mcp-service.ts`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/contracts/rhythm-opencode-contract.json`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/rhythm-opencode-contract.test.mjs`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/tests/fake-opencode/server.mjs`

**Interfaces:**
- Produces classifications `surfaced | internal | alternate | intentionally-omitted` for all 133 bundled operations.

- [x] Write a failing coverage assertion requiring every bundled operation to have one classification and reason.
- [x] Wire the ten existing adapter-only operations into provider actions: directory list, text/symbol search, VCS status/diff/raw, children, PTY detail/resize, and MCP auth removal.
- [x] Add approved adapters for skills/reload, project metadata/Git init, message/part edit/delete, session init/shell, tool schemas/resources, and safe config reload/inspection.
- [x] Keep upgrade/disposal/TUI/v2/workspace-sync/Console operations explicitly omitted and gateway-blocked.
- [x] Run contract sync/check, fake-server self-test, full E2E, lint, and typecheck.

### Task 17: Cross-repository final review and regression gate

**Files:**
- Create: `docs/ai/runs/2026-07-24-rhythm-agent-ios-roadmap.md`
- Modify: `docs/ai/project-state.md`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/README.md`

**Interfaces:**
- Produces a traceable verification matrix from each design success criterion to test evidence.

- [x] Run `git diff main...HEAD` in each repository and GitNexus `detect_changes(scope="compare", base_ref="main")`; investigate unexpected flows.
- [ ] Dispatch a whole-branch code review covering spec compliance, security, accessibility, data ownership, error isolation, and test gaps; return every finding to the relevant coder.
- [x] Run API build/tests, required Flutter format/analyze/tests, mobile foundation/full E2E/contract tests, and secret scanning.
- [x] Verify no credentials, pairing codes, tokens, arbitrary-root proxy paths, destructive migrations, or unclassified endpoints entered either diff.
- [x] Record exact commands, pass/fail counts, known limits, and remaining manual evidence in the run log.

### Task 18: Live backend, EAS signing, physical-device, and TestFlight gate

**Files:**
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/eas.json`
- Modify: `/Users/aj/Documents/opencode-mobile-rhythm-ios-foundation/README.md`
- Modify: `docs/ai/runs/2026-07-24-rhythm-agent-ios-roadmap.md`

**Interfaces:**
- Produces real-engine gateway evidence, signed development artifact, physical-iPhone smoke result, and production/TestFlight artifact.

- [x] Rebuild bundled OpenCode and API server, launch the isolated backend with `RHYTHM_OPENCODE_BIN_DIR`, and run all `RHYTHM_LIVE_E2E=1` gateway tests serially.
- [x] Through secure tooling only, inspect existing EAS/Apple credential availability and GitHub signing workflows; reuse an existing valid distribution/development credential when compatible without exporting it to files or output.
- [ ] Run non-interactive EAS credential/project checks, then create signed development and production iOS builds; record only build IDs/URLs and redacted status.
- [ ] Automate device-registration/profile preparation available through EAS. If Apple requires an on-device trust/install action, defer that single action until every automated signing step has succeeded.
- [ ] Install the signed development build, verify pairing over Tailscale, cloud/Mac failure isolation, chat/SSE/PTy, approvals, every Tool, revocation, background/foreground recovery, and destructive confirmations on a physical iPhone.
- [ ] Submit the production artifact to TestFlight only after automated checks and physical smoke pass; do not merge either repository to `main` without AJ's explicit approval.

## Plan self-review

- **Spec coverage:** All seven delivery-decomposition items and every success criterion map to Tasks 1–18.
- **Laziness gate:** Existing mobile chat/workspace/terminal/provider code, existing Rhythm tool routes, native fetch/SecureStore, existing PTY tickets, and existing EAS launcher are reused. No new state library, networking framework, QR-secret store, proxy framework, or duplicate execution table is introduced.
- **Ownership correction:** Engine/execution/memory-vault records remain paired-Mac-owned because the production deployment deliberately does not run the agent engine and the memory vault is explicitly local-only. Cloud independence is preserved for actual production-owned account, Gmail, Canva, and project metadata; paired-host screens retain read-only caches while offline. This avoids reintroducing the intentionally removed production memory database or building an unsafe two-way execution-control sync.
- **Security:** Authentication precedes project resolution/proxying; device tokens are verifier-only server-side and Keychain-only client-side; gateway paths are allowlisted and server-resolved.
- **No placeholders:** Each task names files, interfaces, failure-first tests, implementation action, and runnable verification.
