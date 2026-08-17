---
date: 2026-08-12
repo: Rhythm
branch: mobile/synology-relay
pr: none
issues: [1387]
status: archived implementation iteration history
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue 1387 implementation iteration history

This file preserves the detailed coding-agent entries that previously accumulated in
`docs/ai/project-state.md`. They were moved here unchanged so the project-state file can remain a
lean current snapshot.

## Recent coding-agent runs

### 2026-08-12 — iOS legacy-architecture Release compatibility
- Files modified: `apps/mobile/app.config.ts` registers the compatibility plugin; `apps/mobile/plugins/with-ios-fmt-cxx17.js` limits only the generated `fmt` pod target to C++17; `apps/mobile/tests/ios-fmt-config-plugin.test.mjs` covers targeting, idempotence, and template drift.
- Checks run: isolated `fmt` C++17 build PASS; app-config and plugin tests PASS; targeted ESLint PASS; mobile typecheck PASS; exact signed physical-device Release `xcodebuild` PASS.
- Decisions made: keep React Native's remaining native targets on C++20 and constrain only pinned `fmt` 11.0.2, whose C++20 consteval parser fails under Xcode 26.5.
- Deviations from spec: no phone install/launch, commit, push, PR, or backend restart, per dispatch.
- Concerns: the generated legacy-architecture build must still be physically smoke-tested to confirm the observed chat-navigation crash no longer occurs.

### 2026-08-12 — remove FlashList v2 from legacy mobile runtime
- Files modified: `apps/mobile/components/chat/chat-content.tsx` replaces the sole FlashList v2 usage with React Native `FlatList` while preserving initial-bottom and near-bottom following; `apps/mobile/tests/legacy-architecture-list.test.mjs` prevents runtime source from importing FlashList v2.
- Checks run: compatibility regression 2/2 PASS; mobile typecheck PASS; targeted ESLint PASS; exact signed physical-device Release `xcodebuild` PASS; built Hermes bundle contains no FlashList v2 import/error string.
- Decisions made: retained the installed package but removed every runtime import, avoiding dependency-lock churn during active device iteration.
- Deviations from spec: the unrelated issue-1238 keyboard contract currently fails against a shared-worktree composer change (`scrollEnabled` shorthand); no phone install/launch, commit, push, PR, or backend restart.
- Concerns: physical smoke must confirm chat route startup and transcript scrolling on the legacy runtime.

## Recent coding-agent runs

### 2026-08-12 — bound mobile OpenCode runtime inspection
- Files modified: `apps/mobile/providers/services/opencode-inspection-service.ts` (shared 12-second abort budget and clean errors); `apps/mobile/tests/issue-1174-security.test.mjs` (timeout and HTML-response regressions).
- Checks run: issue-1174/1387 node tests 7/7 pass; mobile typecheck pass; targeted ESLint pass; targeted `git diff --check` pass.
- Decisions made: abort every concurrent inspection read under one budget so a slow MCP resource request cannot keep the screen waiting or leave sibling requests alive.
- Deviations from spec: physical-device rebuild and relay retest intentionally left to the smoke-test owner.
- Concerns: the 12-second budget needs confirmation against a legitimately cold production relay; the upstream `/experimental/resource` latency remains unchanged.

### 2026-08-12 — Workspace Files relay search feedback
- Files modified: `apps/mobile/app/agents/workspace.tsx` (direct results, 12-second bound, empty state); `apps/mobile/providers/opencode-provider.tsx`, `providers/opencode-provider-types.ts`, and `providers/services/workspace-service.ts` (return results and propagate abort); `apps/mobile/tests/workspace-search.test.tsx` and `docs/ai/contracts/issue-1387.json` (criteria c12-c14).
- Checks run: focused Jest 3/3 pass; mobile TypeScript pass; targeted ESLint pass; targeted `git diff --check` pass.
- Decisions made: consume the awaited response directly while preserving provider state for existing consumers; abort the underlying SDK request as well as racing a UI deadline.
- Deviations from spec: physical-device rebuild/retest left to the smoke-test owner as dispatched.
- Concerns: the 12-second deadline should be confirmed against a cold but healthy production relay.

### 2026-08-12 — Gallery Cloud Gateway artifact opening
- Files modified: `apps/mobile/app/tools/[tool].tsx` (actionable Gallery cards, image/video preview, explicit unavailable state); `apps/mobile/providers/rhythm-tools-provider.tsx`, `providers/services/rhythm-tools-service.ts`, and `lib/transport/paired-mac-client.ts` (project-scoped authenticated relay media source); Gallery/relay contract tests and `docs/ai/contracts/issue-1387.json` (criteria c15-c16).
- Checks run: Gallery node contracts 6/6 pass; relay transport Jest 8/8 pass; mobile TypeScript pass; targeted ESLint pass.
- Decisions made: use the legacy design artifact endpoint through the active Cloud Gateway base because existing Gallery rows do not expose the newer relay-cached media artifact ID; never use the direct PTY base for Gallery.
- Deviations from spec: physical-device rebuild/retest left to the smoke-test owner as dispatched.
- Concerns: legacy Gallery artifacts remain Mac-online reads; offline relay caching requires a future stable MediaArtifact ID on Gallery records.

### 2026-08-12 — issue 1387 cached transcript while desktop offline
- Files modified: `apps/mobile/providers/opencode-provider.tsx` allows only the existing-session read gate to continue when the authenticated relay is reachable and Mac presence is `desktop-offline`.
- Checks run: c17 red reproduced, then PASS; related session/relay contracts 45/45 PASS; paired-host scenarios PASS; mobile typecheck PASS; mobile lint PASS with three pre-existing warnings; targeted diff check PASS.
- Decisions made: scope the exception to a paired host with a configured relay URL and `desktop-offline`; other connection/auth failures and write/new-session paths retain their existing guards.
- Deviations from spec: none.
- Concerns: physical-device smoke still needs to prove the relay-mirrored transcript opens with the Mac uplink offline.

### 2026-08-12 — issue 1387 Workspace file preview
- Files modified: `apps/mobile/providers/opencode-provider.tsx` commits successful text reads using the current-client generation guard; `apps/mobile/app/agents/workspace.tsx` shows an explicit in-app opening state and preserves readable/binary/error feedback; `docs/ai/contracts/issue-1387.json` records c18 passing.
- Checks run: c18 red reproduced, then PASS; Workspace preview/search Jest 4/4 PASS; mobile typecheck PASS; targeted ESLint PASS; targeted diff check PASS.
- Decisions made: use the provider's established client-generation freshness check because paired catalog IDs and scoped client directories can intentionally differ.
- Deviations from spec: none.
- Concerns: physical-device smoke still needs to verify a production Relay README opens and remains readable.

### 2026-08-12 — issue 1387 healthy relay presence after send
- Files modified: `apps/mobile/providers/opencode-provider.tsx` revalidates a request-derived Mac-offline result against the current Cloud Gateway health body; `docs/ai/contracts/issue-1387.json` records c19 passing.
- Checks run: c19 RED reproduced then PASS; c19 plus relay-offline Jest 7/7 PASS; paired-host/reachability Node contracts 10/10 PASS (including the 23-scenario paired-host script); mobile typecheck PASS; targeted ESLint and diff check PASS.
- Decisions made: treat the current gateway health body as the authoritative presence signal, while retaining offline when health reports anything other than online or cannot be reached.
- Deviations from spec: none.
- Concerns: physical-device smoke must confirm repeated real sends remain Connected without the prior transient offline banner.

### 2026-08-12 — issue 1387 bounded paired-tool loading
- Files modified: `apps/mobile/providers/rhythm-tools-provider.tsx` keeps screen refresh stable across equivalent service replacements, guards async results by request cache scope, and gives paired screen loads a 12-second retryable deadline; `apps/mobile/tests/contract/issue-1387-gallery-loading.test.tsx` reproduces service churn plus the real wrapper's account/pairing/project hydration and covers Gallery plus Profiles; `docs/ai/contracts/issue-1387.json` records c20 passing.
- Checks run: original c20 RED reproduced then PASS; after two physical smoke failures, strengthened service-churn and full-wrapper hydration contracts each reproduced RED, then all c20 cases passed 4/4; Gallery/project-scoped tool contracts 14/14 PASS; mobile typecheck PASS; targeted ESLint and diff check PASS. A broader 29-test probe had 27 PASS and two unrelated shared-worktree source-contract failures.
- Decisions made: keep the deadline in the LOW-risk shared screen-loading provider boundary; store the latest service in a ref so equivalent service identity churn cannot restart the mounted screen effect; on cache-scope changes clear old display state without invalidating a child refresh already begun for the new scope, and guard every async outcome against its captured scope; leave the CRITICAL `pairedRequest` method and all tool mutations unchanged; preserve the existing cache-recovery path after timeout.
- Deviations from spec: none.
- Concerns: a second physical-device rebuild/smoke must confirm Gallery and Profiles leave loading within 12 seconds and retry successfully; the timed-out transport promise cannot be aborted without widening into the CRITICAL shared request boundary.

### 2026-08-12 — issue 1387 Models optional-auth loading
- Files modified: `apps/mobile/providers/services/rhythm-tools-service.ts` bounds provider-auth enrichment independently from essential provider/config reads; `apps/mobile/tests/contract/issue-1387-models-loading.test.tsx` keeps the real Models route/provider/service regression fixture type-safe; `docs/ai/contracts/issue-1387.json` records c21 passing.
- Checks run: exact c21 RED reproduced, then PASS; Models/tool contracts 15/15 PASS; c20/c21 UI contracts 5/5 PASS; mobile typecheck PASS; targeted ESLint and diff check PASS. One broader device-parity run had 23/24 PASS with an unrelated shared-worktree session source-text assertion already noted by the c20 run.
- Decisions made: provider catalog and config remain essential; optional provider-auth enrichment gets a separate two-second budget and degrades to no auth metadata on timeout/error without removing usable provider/model data.
- Deviations from spec: none.
- Concerns: physical-device smoke must confirm Providers & Models renders through the production Cloud Gateway and that fast provider-auth responses still expose authentication actions.

### 2026-08-12 — issue 1387 cold offline chat relaunch
- Files modified: `apps/mobile/providers/opencode-provider.tsx` opens existing scoped sessions through authenticated project-specific relay reads without the unavailable live project catalog; `apps/mobile/lib/opencode/client.ts` classifies the relay's two Mac-offline 503 codes for the generated-client path; `apps/mobile/providers/paired-host-provider.tsx` exposes same-state refresh revisions; `apps/mobile/app/agents/chats/[sessionId].tsx` retries a terminal open on each newly readable connection state; `docs/ai/contracts/issue-1387.json` records c22/c24 passing.
- Checks run: strengthened c22/c24 RED reproduced, then 2/2 PASS; focused route/cache/offline/false-offline Jest 14/14 PASS; c17/open-session/reachability/paired-host Node contracts 23/23 PASS; mobile typecheck PASS; targeted ESLint and diff check PASS.
- Decisions made: keep general clients, writes, new sessions, conversation mode, and live streams behind the registered-project/connected gates; only the existing-session read pipeline constructs a project-scoped authenticated relay client and relies on server authorization. A paired refresh revision recovers same-snapshot transitions when the Mac returns.
- Deviations from spec: none.
- Concerns: physical cold-process smoke still needs to confirm both complete-mirror opening and incomplete-mirror recovery against the production Cloud Gateway.

### 2026-08-12 — issue 1387 native Cloud Gateway Terminal PTY
- Files modified: the relay uplink protocol/client/server now multiplex bounded, project-scoped PTY WebSockets; the relay gateway advertises WebSocket upgrade instead of direct-only failure; `PairedMacClient` uses only its active Cloud Gateway base for Terminal; c23 integration and relay transport contracts cover the behavior.
- Checks run: c23 RED reproduced, then exact c23 PASS; focused API relay/realtime/PTY safety suite 46/46 PASS; mobile relay Jest 6/6 and transport client scenarios PASS; API and mobile typechecks PASS; targeted mobile ESLint and repository diff check PASS. API `npm run lint` exits zero but is currently only a `TODO: add eslint` placeholder.
- Decisions made: carry PTY open/data/close frames over the existing authenticated Mac uplink, authenticate the phone again at the relay, preserve device/project/ticket/cursor scope, and isolate individual terminal closure from the shared uplink; see `docs/ai/decisions/2026-08-12-native-cloud-gateway-pty-uplink.md`.
- Deviations from spec: the real deployed Cloudflare route and physical phone were intentionally left to the smoke-test owner; no commit, push, PR, CI, or production mutation was performed.
- Concerns: physical smoke must confirm Cloudflare WebSocket upgrade forwarding and sustained interactive PTY traffic; base64 JSON framing adds overhead despite connection/frame/backpressure bounds.

### 2026-08-12 — issue 1387 cold Gallery project hydration
- Files modified: `apps/mobile/providers/rhythm-tools-provider.tsx` preserves a loading state while OpenCode persistence restores the active project; `apps/mobile/tests/contract/issue-1387-gallery-loading.test.tsx` covers persisted-project restoration plus the genuine hydrated no-project state; `docs/ai/contracts/issue-1387.json` records c25 passing.
- Checks run: c25 RED reproduced then PASS; c20/c21/c25 tool UI regressions 7/7 PASS; project-scoped/Gallery provider contracts 14/14 PASS; mobile typecheck PASS; targeted ESLint and diff check PASS. A broader provider probe was 18/19, with only the pre-existing issue-1173 legacy `/agent-designs` expectation failing against the already-integrated Cloud Gateway Gallery route.
- Decisions made: model pre-hydration project absence as `restoring` in the shared tools provider, then retain `missing-scope` only after persistence hydration confirms there is no active project.
- Deviations from spec: none.
- Concerns: physical cold-launch smoke must confirm the false Select a project flash is gone before Gallery artifacts render.

### 2026-08-12 — issue 1387 truthful offline Agents catalog
- Files modified: `apps/mobile/components/chat/chat-list.tsx` uses the OpenCode desktop-offline state and a safe cached `projectName` fallback; `apps/api_server/src/services/mobile_chat_catalog.ts` projects the existing project name without exposing its path; focused mobile/API contracts cover both behaviors.
- Checks run: c26/c27 RED 2/2 reproduced, then PASS 2/2; focused mobile catalog/cold-relaunch/discovery regressions PASS 20/20; c17 PASS; API real-HTTP mirror PASS 8/8 and relay mirror PASS 7/7; mobile/API typechecks and targeted mobile ESLint PASS; API lint remains the repository's zero-exit placeholder; targeted diff check PASS.
- Decisions made: online volatile project labels retain priority, with the sanitized mirrored name used only as fallback; relay rows expose nullable project names only when safe project metadata is present, never filesystem paths.
- Deviations from spec: none. The pre-existing issue-1231-c2 source-regex contract still expects an obsolete deduplication implementation shape and is out of scope for c26/c27.
- Concerns: older caches need one successful catalog refresh before they carry `projectName`; physical-device rebuild and offline relay smoke remain required.

