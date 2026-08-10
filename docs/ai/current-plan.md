# Current Plan — Cloud Live Artifacts / Worship Calendar

**Date:** 2026-08-10
**Branch:** `feat/artifact-viewer` (synced with `origin/main` `8a3561d9`)
**Status:** **COMPLETE — AV-01–AV-07 final verification PASS; ready for draft PR and human smoke**
**Supersedes:** the local-file/Gallery Artifact Viewer plan previously in this file

The approved design and acceptance contract below remain the durable scope record. Final results are in `docs/ai/contracts/live-artifacts-av07.json` and `docs/ai/runs/2026-08-09-live-artifacts-av07.md`.

## Goal

Ship the smallest secure cloud-hosted collaborative **live artifact** platform needed for an org/shared Worship Calendar, with stable Dashboard tabs, versioned HTML/CSS/JS, separate JSON state, agent/user editing, and a narrow current-user PCO read capability.

## Constraints and non-goals

- Work only in the isolated worktree above. The unrelated dirty mobile checkout is out of bounds.
- This is hosted user data: the production API on Synology owns it, Postgres is authoritative in production, and SQLite remains the local/test implementation.
- Artifact bundle/state bytes live only under an app-managed server directory. Postgres/SQLite hold stable IDs, authorization metadata, revision/hash pointers, sharing, and audit fields. API responses never contain filesystem paths or internal storage keys.
- `agent_designs` and Gallery remain creative-media/local-file infrastructure. Do not relabel, migrate, or reuse their path semantics.
- V1 supports only `type: html` live artifacts and only the capability needed by Worship Calendar: `pco.services.read`.
- Artifact JavaScript may update its own JSON state and request declared host capabilities. It receives no bearer/integration credentials and no generic fetch, URL, filesystem, shell/process, popup, top-navigation, download, or computer-control bridge.
- Named agent/computer actions remain ordinary agent-session work governed by existing profile scope, MCP guards, and approvals. No artifact-specific bypass or approval system.
- PCO freshness is explicit **Sync from PCO** or one sync-on-open request. No polling or artifact scheduler. Later unattended refresh must use existing scheduled Rhythm jobs.
- V1 has no generic plugin/process sandbox, Gallery merge, local-file import, arbitrary capability registry, artifact marketplace, user-facing bundle IDE, reorder/rename-in-tab, or bulk tab/artifact manager.
- Migrations are additive and idempotent. No drop, truncate, destructive rewrite, or production data deletion.
- Every backend/live command uses `tools/dev/sandbox.sh`; never start `api_server` or the engine by hand.

## Approved design

### 1. Cloud data and storage boundary

Add a new always-on `/live-artifacts` production surface, outside `env.agentExecutionEnabled`, protected by `requireAuth`.

Use these records:

- `live_artifacts`: UUID `id`, `type = 'html'`, `title`, `owner_user_id`, `workspace_id`, `visibility` (`private | shared | organization`), current bundle/state revisions and hashes, declared capabilities, `created_at`, `updated_at`, `updated_by_user_id`, and nullable `deleted_at`/`deleted_by_user_id`.
- `live_artifact_collaborators`: `(artifact_id, user_id)` composite key plus `added_at`/`added_by_user_id`, following `task_collaborators`.
- `live_artifact_bundle_revisions`: append-only revision/hash/audit metadata.
- `live_artifact_state_revisions`: append-only state revision/hash/audit metadata. JSON bytes remain separate from bundle bytes.
- `users.artifact_tab_ids_json`: additive per-user preference storing ordered stable IDs. V1 restores the open set and starts on Dashboard; it does not need to persist the active tab.

Add `LIVE_ARTIFACT_STORAGE_DIR`; hosted config points it at `/data/live-artifacts`, and sandbox startup points it inside its isolated sandbox directory. The existing Synology `/data` volume remains the persistence boundary.

The storage service derives every location from server-owned `artifactId`, content hash, and fixed filenames:

```text
<root>/<artifact-id>/bundles/<sha256>/{index.html,styles.css,app.js}
<root>/<artifact-id>/state/<sha256>.json
```

Clients never submit or receive paths. Writes use a sibling temporary name plus atomic rename; DB publication occurs only after a complete immutable content-addressed write. A failed compare-and-swap does not change the current pointer. Soft deletion preserves history and makes stable IDs resolve to a deleted response instead of deleting production bytes.

Keep the existing Express 1 MiB request ceiling. Reject decoded state above 512 KiB and any decoded bridge request/response above 1 MiB before storage or dispatch; the Worship Calendar fixture must remain below those limits.

### 2. Authorization and concurrency

Reuse task/workspace authorization semantics, but add the missing organization predicate:

| Visibility | Read/update bundle or state | Manage visibility/collaborators/delete |
|---|---|---|
| `private` | owner only | owner only |
| `shared` | owner + selected collaborators | owner only |
| `organization` | owner + current members of `workspace_id` | owner only |

- Selected collaborators must be current members of the artifact workspace, following shared-transcript recipient validation.
- Unauthorized list rows are omitted and unauthorized IDs return a non-disclosing `404`. An actor who retained access to an already-open soft-deleted artifact receives a path-free `410 artifact_deleted` tombstone so that tab can show its deleted state; all other callers receive `404`.
- Bundle and state writes carry independent `expectedBundleRevision` / `expectedStateRevision`. The repository performs one atomic `UPDATE ... WHERE current_revision = expected`; zero changed rows returns `409` with the current public revision, never silent last-write-wins.
- Every successful write records the authenticated `updatedByUserId`; append-only revision rows preserve who changed what and when.
- Capability grants are an allowlisted metadata field managed by the owner. A collaborator may change bundle/state but cannot grant a new capability.

### 3. Minimal API and agent contract

The JSON API is deliberately small:

- `GET /live-artifacts?type=html&search=...` — visible, non-deleted metadata only.
- `POST /live-artifacts` — create metadata, initial `{html, css, js}` bundle, initial JSON state, visibility/collaborators, and allowlisted capabilities.
- `GET /live-artifacts/:id` — metadata plus current state; no bundle bytes or storage details.
- `GET /live-artifacts/:id/render` — authenticated, CSP-constrained assembled document for the current bundle.
- `PATCH /live-artifacts/:id` — title/visibility/capability metadata under the rules above.
- `GET/POST /live-artifacts/:id/collaborators` and `DELETE /live-artifacts/:id/collaborators/:userId` — task-like collaborator management, owner-only for writes.
- `PUT /live-artifacts/:id/bundle` and `PUT /live-artifacts/:id/state` — optimistic revision writes.
- `DELETE /live-artifacts/:id` — owner-only soft delete.
- `POST /live-artifacts/:id/capabilities/pco.services.read` — one declared, typed current-user PCO read request.

Add exactly five focused Rhythm MCP tools: `rhythm_list_live_artifacts`, `rhythm_get_live_artifact`, `rhythm_create_live_artifact`, `rhythm_update_live_artifact_state`, and `rhythm_update_live_artifact_bundle`. They call the hosted `RHYTHM_API_URL` with the existing user-bound token, use the same API authorization/CAS contract, and are classified by the existing external-content/action security graph. Do not add an artifact scheduler or a generic capability-execution tool.

### 4. Script runtime and capability bridge

Use the official WKWebView-backed `webview_flutter` package after a one-screen compatibility probe against the repo's resolved Flutter/macOS SDK. The previous design check found official macOS support in `webview_flutter` 4.14.1; exact resolution remains a pre-code check.

The server assembles the document from the three fixed bundle files and sends a restrictive HTTP policy:

- CSP defaults to none; only the server-nonced inline bundle CSS/JS may execute.
- `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, `frame-src 'none'`, `object-src 'none'`; images are limited to `data:`/`blob:` only if the Worship Calendar needs them.
- `X-Content-Type-Options: nosniff`; no redirects; no credentials embedded in markup.
- Artifact-provided script tags/event handlers do not receive the nonce. Only the separately stored `app.js` bundle runs.

WKWebView receives the initial authenticated render request, blocks all later top-level navigation, new windows/popups, downloads, and external URLs, and exposes exactly one JSON message channel. The host binds the selected artifact ID itself (never trusts an ID from script), validates operation name/payload/size, and supports only:

- `state.get`
- `state.update` with `expectedStateRevision`
- `pco.services.read` when declared on that artifact

Responses return through a fixed callback/event with safely JSON-encoded data. No raw Dart object, auth token, API URL, arbitrary HTTP method, or JavaScript evaluation input crosses the bridge.

For PCO, the API accepts only `serviceTypes.list`, `plans.list` (`serviceTypeId`, `filter: future | past`), and `planItems.list` (`serviceTypeId`, `planId`). It derives `req.auth.user.id`, calls `IntegrationsService.ensureFreshPlanningCenterAccount`, and maps those operations to `PlanningCenterService.listServiceTypes`, `listPlans`, and `listPlanItems`. The current viewer's integration is used—not the owner's—and only constrained result data returns.

### 5. Shipping Flutter Dashboard interaction

Keep `DashboardView` itself unchanged. Add a toolbar strip above the existing content card in `AppShell` when the Dashboard navigation item is selected:

- Fixed, non-closable **Dashboard** tab first.
- Ordered open artifact tabs from the signed-in user's server preference.
- A fixed trailing **+** picker control that remains visible while tabs horizontally scroll/overflow.
- Selecting an artifact tab resolves its stable ID through the hosted API and always loads current bundle/state revisions.
- Closing a tab updates only the user preference; it never deletes the artifact.
- The picker is keyboard-accessible, searchable by title, and lists only visible `type: html` live artifacts—not Gallery records or other media.
- Each tab owns its own loading/update/conflict/deleted/forbidden/error state so one failure does not replace Dashboard or sibling tabs.
- Titles truncate visually with tooltip/full semantic label. Support Tab/Shift-Tab, Left/Right between tabs, Enter/Space activation, Delete/Backspace close only when focus is on a closable artifact tab, Escape from picker, and predictable focus return to `+` or the neighboring tab.
- V1 explicitly omits reorder, inline rename, and bulk management.

### 6. First validating artifact: Worship Calendar

The validating bundle is an org/shared calendar replacing the current Google Sheet. Its state schema contains calendar entries with stable entry IDs and at least:

```json
{
  "serviceDate": "YYYY-MM-DD",
  "title": "string",
  "scripture": "string",
  "theme": "string",
  "serviceDetails": {},
  "pco": { "serviceTypeId": "string|null", "planId": "string|null", "lastSyncedAt": "ISO|null" }
}
```

Pastor, selected collaborators, or org members (according to visibility) can add/edit entries through `state.update`; agents can make the same state change through the MCP tool. **Sync from PCO** performs one typed capability read and then one revision-checked state update. `sync-on-open` may perform the same sequence once per tab open; no timer/background loop is allowed.

The Worship Calendar bundle is the only required executable fixture for V1. Its HTML/CSS/JS may be created through the normal live-artifact create contract; no product-level template marketplace or generic plugin SDK is required.

## Explicit acceptance contract

| ID | Falsifiable acceptance criterion |
|---|---|
| AC1 | Creating a live artifact returns a stable UUID, `type: html`, revision/hash metadata, owner/workspace/visibility, timestamps, and no path/storage key; the same ID resolves the latest bundle and state after updates. |
| AC2 | Bundle and state bytes exist only beneath the configured app-managed root at server-derived names; traversal/path input is rejected or impossible, partial writes never become current, and API/log output contains no internal path. |
| AC3 | Private, shared, and organization list/detail/update behavior matches the authorization table for owner, collaborator, same-workspace non-collaborator, other-workspace user, and unauthenticated caller; only owner manages sharing/capabilities/deletion. |
| AC4 | Two writes with the same expected revision yield exactly one success and one `409`; the winner's actor/revision/hash is persisted and the loser never overwrites it. Bundle and state conflicts are independent. |
| AC5 | Soft-deleted IDs disappear from picker/list, return the defined deleted/not-found state to an already-open tab, and retain metadata/content for operator recovery. Closing a tab does not call delete. |
| AC6 | Artifact JS can render and call only `state.get`, revision-checked `state.update`, and declared `pco.services.read`; hostile attempts at network/file/local-API access, forms, frames, popups, downloads, navigation, undeclared capability, or arbitrary host method produce no side effect or credential disclosure. |
| AC7 | `pco.services.read` uses the viewing user's secured PCO account and returns only named service/plan/item summaries. Missing connection, PCO denial, offline error, and state conflict are isolated and recoverable in that tab. |
| AC8 | A real agent using Rhythm MCP creates/opens a Worship Calendar and changes scripture/title/theme/service data through the hosted API contract; a human collaborator sees the changed state under the same stable ID without a second artifact row. |
| AC9 | Dashboard remains visually/behaviorally unchanged when its fixed tab is selected. Open artifact tabs restore per signed-in user; `+` stays visible under overflow; picker search is HTML/live-only; close, keyboard, focus, truncation, semantics, and per-tab failure isolation match the approved interaction spec. |
| AC10 | Worship Calendar supports manual entry/edit and explicit PCO sync (plus optional once-on-open mode), with no polling or background execution. |
| AC11 | SQLite migration and Postgres bootstrap expose equivalent live-artifact/user-preference columns, constraints, defaults, and indexes; Postgres bootstrap succeeds twice against a real test database. No destructive SQL is introduced. |
| AC12 | A sandbox run against the real API + fork engine, native macOS runtime evidence, accessibility tests, and deterministic screenshots are recorded with exact commands/results under `docs/ai/runs/` before the feature is called done. |

## Likely file and symbol map

### Hosted API / persistence

| File | Responsibility / likely symbols |
|---|---|
| `apps/api_server/src/database/migrations.ts` | Additive SQLite tables/columns/indexes. |
| `apps/api_server/src/database/postgres_bootstrap.ts` | Idempotent Postgres-equivalent DDL/backfill. |
| `apps/api_server/src/database/migrate_sqlite_to_postgres.ts` | Add new tables to the fixed migration allowlist; never use `--reset-target` for rollout. |
| `apps/api_server/src/config/env.ts` | Resolve `LIVE_ARTIFACT_STORAGE_DIR`. |
| `apps/api_server/.env.production.example` | Document `/data/live-artifacts`. |
| `apps/api_server/src/models/live_artifact.ts` (new) | Public metadata, revision, visibility, bundle/state DTOs. |
| `apps/api_server/src/repositories/live_artifacts_repository.ts` (new) | Visibility queries, collaborator membership, append-only revisions, atomic CAS, audit. Reuse `TasksRepository`/`SharedTranscriptsRepository` predicates. |
| `apps/api_server/src/services/live_artifact_storage.ts` (new) | Size/type validation, hashes, fixed path derivation, atomic immutable writes/reads; never expose paths. |
| `apps/api_server/src/controllers/live_artifacts_controller.ts` (new) | Authenticated CRUD, validation, owner-only controls, conflict/deleted response shaping. |
| `apps/api_server/src/routes/live_artifacts_routes.ts` (new) | Always-on authenticated `/live-artifacts` routes. |
| `apps/api_server/src/controllers/live_artifact_capabilities_controller.ts` (new) | Closed `pco.services.read` dispatcher using current-user integration. |
| `apps/api_server/src/routes/live_artifact_capability_routes.ts` (new) | Typed capability subroute only; no generic operation URL. |
| `apps/api_server/src/app.ts` | Mount always-on routers outside the agent-execution gate. |
| `apps/api_server/src/models/user.ts`, `repositories/users_repository.ts`, `controllers/users_controller.ts` | Round-trip validated `artifactTabIds` per signed-in user. |
| `tools/dev/sandbox.sh` | Set storage root inside the existing sandbox lifecycle. |

### Agent surface

| File | Responsibility / likely symbols |
|---|---|
| `apps/mcp_server/src/tools/liveArtifacts.ts` (new) | Hosted list/get/create/update-state/update-bundle tools with revision fields. |
| `apps/mcp_server/src/index.ts` | Register tools; implementation PR must report the changed tool count. |
| `apps/mcp_server/src/security/external_content_roles.ts` and focused graph tests | Classify reads as external/untrusted and writes as normal authorized actions. |

### Shipping Flutter

| File | Responsibility / likely symbols |
|---|---|
| `apps/desktop_flutter/pubspec.yaml`, `pubspec.lock`, macOS generated registrant | Pin WKWebView dependency after compatibility probe. |
| `apps/desktop_flutter/lib/features/live_artifacts/models/live_artifact.dart` (new) | Metadata/state/revision/conflict models. |
| `apps/desktop_flutter/lib/features/live_artifacts/data/live_artifacts_data_source.dart` (new) | Authenticated hosted list/detail/state/capability calls. |
| `apps/desktop_flutter/lib/features/live_artifacts/controllers/live_artifacts_controller.dart` (new) | Open-ID persistence and independent state per artifact ID. |
| `apps/desktop_flutter/lib/features/live_artifacts/views/dashboard_artifact_tabs.dart` (new) | Fixed Dashboard tab, scrolling artifact tabs, fixed `+`, close/focus/keyboard semantics. |
| `apps/desktop_flutter/lib/features/live_artifacts/views/live_artifact_picker.dart` (new) | Searchable HTML-only picker with loading/empty/error states. |
| `apps/desktop_flutter/lib/features/live_artifacts/views/live_artifact_view.dart` (new) | Per-tab loading/deleted/conflict/error UI and secure WKWebView lifecycle. |
| `apps/desktop_flutter/lib/features/live_artifacts/services/live_artifact_bridge.dart` (new) | Closed JSON bridge, selected-ID binding, safe response encoding. |
| `apps/desktop_flutter/lib/app/core/layout/app_shell.dart` | Show toolbar only for Dashboard nav and switch Dashboard/artifact content without changing `DashboardView`. |
| `apps/desktop_flutter/lib/features/settings/data/user_preferences_data_source.dart` | Persist ordered artifact tab IDs through `/users/me/preferences`. |

### Focused evidence

| File | Responsibility |
|---|---|
| `apps/api_server/src/__tests__/live_artifacts.test.ts` (new) | API/auth/CAS/storage/non-disclosure contracts. |
| `apps/api_server/src/__tests__/live_artifacts_schema_parity.test.ts` (new) | SQLite/Postgres DDL parity. |
| `apps/api_server/src/__tests__/live_artifacts_live_e2e.test.ts` (new) | Env-gated real sandbox API + engine/MCP behavior. |
| `apps/mcp_server/src/tools/__tests__/liveArtifacts.test.ts` (new) | Tool schemas/routing/revision/error contracts. |
| `apps/desktop_flutter/test/features/live_artifacts/` (new) | Toolbar, picker, per-tab isolation, bridge, keyboard, semantics, golden tests. |
| `apps/desktop_flutter/integration_test/live_artifacts_macos_test.dart` (new) | Real WKWebView hostile fixture, bridge, render, screenshot evidence. |
| `docs/ai/runs/<date>-live-artifacts.md` | Exact pass/fail commands, screenshots, observed output, build SHA. |
| `docs/testing/manual-smoke.md` | Add the approved Dashboard/live-artifact/a11y/security smoke path. |
| `docs/release/hosted_deployment_synology_cloudflare.md` | Storage env/volume, additive bootstrap, backup/rollback verification. |

Implementation agents must run GitNexus upstream impact before changing every existing symbol above and warn on HIGH/CRITICAL risk.

## Thin implementation slices

| Slice | Thin deliverable and acceptance | Likely ownership | Depends on | Required validation |
|---|---|---|---|---|
| **AV-01 — Additive schema + storage root** | Both DBs define artifact/collaborator/bundle-state revision metadata and `artifactTabIds`; env/sandbox/hosted docs define isolated persistent storage; parity and idempotency satisfy AC1/AC2/AC11. No route yet. | DB/env files, parity test, sandbox/deploy docs. | None. | `npx vitest run src/__tests__/live_artifacts_schema_parity.test.ts`; `node_modules/.bin/tsc --noEmit`; real Postgres bootstrap command in Validation V3; `tools/dev/sandbox.sh up/status/down` proves scoped root. |
| **AV-02 — Authenticated artifact CRUD + CAS** | New always-on API can create/list/detail/render/update/soft-delete; task-like sharing + org membership, immutable storage, revisions/hashes/audit, non-disclosing 404, and concurrent 409 satisfy AC1–AC5. | New API model/repository/storage/controller/routes, `app.ts`, API contract test. | AV-01. | Validation V1 plus focused `live_artifacts.test.ts`; include simultaneous-write test and hostile path/non-disclosure cases. |
| **AV-03 — Agent artifact tools + Worship fixture** | Hosted MCP tools create the HTML/CSS/JS + JSON Worship Calendar, read it, and revision-update bundle/state under the authenticated actor; tool security classification and real stable-ID update satisfy AC8. | `apps/mcp_server` new tool/test/index/security graph; Worship fixture used by tests. | AV-02. | Validation V2; then V4 real engine-driven create/update/read. Report exact MCP tool-count delta. |
| **AV-04 — Per-user Dashboard tabs + picker** | Flutter models/data/controller restore open IDs per user; AppShell shows fixed Dashboard, dynamic accessible tabs, fixed visible `+`, HTML-only search picker, close-without-delete, overflow/keyboard/focus/truncation, and per-ID loading/error boundaries. Dashboard body stays unchanged. Satisfies the non-WebView parts of AC5/AC9. | Flutter live-artifact model/data/controller/tab/picker files, `app_shell.dart`, preferences data source, widget/golden tests. | AV-02. | Validation V5 focused widget/semantics/golden checks; verify two signed-in users restore different tab sets. |
| **AV-05 — Closed PCO capability endpoint** | Declared `pco.services.read` dispatches only named reads through the viewing user's refreshed integration; undeclared/unknown operations fail closed; explicit/on-open has no polling. Satisfies API side of AC6/AC7/AC10. | New API capability controller/router/tests; existing PCO service is reused, not broadened. | AV-02. | Focused capability route tests + existing `pco_broker_routes.test.ts`; V1 typecheck; two-user token-binding assertion; no raw PCO/token logging. |
| **AV-06 — Secure native runtime + Worship Calendar** | WKWebView renders current bundle, bridge permits only state get/update + declared PCO read, Worship form edits and explicit/once-on-open sync work, conflicts recover per tab, and hostile runtime cannot escape. Satisfies AC6–AC10. | Flutter runtime/bridge/view, dependency files, native integration and widget tests. | AV-04 and AV-05; uses AV-03 fixture. | Compatibility probe first; Validation V5 + V6. Do not proceed if macOS plugin cannot enforce the approved policy. |
| **AV-07 — Integrated production gate and evidence** | Real engine/MCP → hosted API → cloud state → Flutter reload works under one stable ID; Postgres/SQLite parity, security matrix, screenshots/a11y/manual smoke, backup/storage deployment and rollback evidence satisfy AC11/AC12. No product expansion. | Tests/docs only except defects found by gates return to their owning slice. | AV-01…AV-06. | Validation V3–V7, `ai-workflow checks --level pr`, GitNexus compare-to-main, run log with exact outputs. Draft PR/human smoke handoff only. |

### Parallel/disjoint ownership

- **AV-01 then AV-02 are sequential foundations.** Do not parallelize schema and repository contract work.
- After AV-02 lands, **AV-03, AV-04, and AV-05 may run in parallel**: MCP-only, Flutter tab/picker-only, and API-capability-only ownership is disjoint. AV-05 must use its own controller/router files; avoid editing AV-02's repository except for a proven authorization defect.
- AV-06 waits for AV-04/AV-05 and consumes AV-03's fixture. AV-07 is last.
- Use fresh implementation dispatches after this planning turn; do not carry the research swarm context into coding agents.

## Exact validation expectations

All commands run from this isolated worktree. No command may target the unrelated checkout.

### V1 — API static and focused contracts

```bash
cd apps/api_server
npx vitest run src/__tests__/live_artifacts.test.ts src/__tests__/live_artifacts_schema_parity.test.ts
node_modules/.bin/tsc --noEmit
```

The tests must cover unauthenticated, owner, collaborator, same-org, cross-org, private/shared/org, capability-owner-only, soft-delete, no-path/log disclosure, immutable hash storage, independent bundle/state CAS, and one-winner concurrent writes on SQLite.

### V2 — MCP contract

```bash
cd apps/mcp_server
npx vitest run src/tools/__tests__/liveArtifacts.test.ts src/security/__tests__/external_content_role_graph.test.ts
npm run typecheck
npm run lint
npm run build
```

The tool test must prove hosted `RHYTHM_API_URL` routing, bearer forwarding without logging it, exact expected-revision fields, 409 propagation, and no generic capability/scheduler tool.

### V3 — SQLite/Postgres parity and production bootstrap

```bash
cd apps/api_server
RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1 \
RHYTHM_LIVE_POSTGRES_URL="$THROWAWAY_POSTGRES_URL" \
  npx vitest run src/__tests__/postgres_bootstrap_live.test.ts src/__tests__/live_artifacts_schema_parity.test.ts
```

Run only against a throwaway Postgres database. Bootstrap must pass twice, and inspection must match SQLite columns, constraints, defaults, and indexes. Review `migrate_sqlite_to_postgres.ts` allowlist without invoking `--reset-target`; any `DROP`, `TRUNCATE`, destructive `ALTER`, or row deletion fails the gate.

### V4 — Required real API + engine behavior

Use only the existing sandbox lifecycle; it must inject its own DB, HOME, ports, and live-artifact storage root:

```bash
tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
  npx vitest run src/__tests__/live_artifacts_live_e2e.test.ts --no-file-parallelism
cd ../..
tools/dev/sandbox.sh down
```

The env-gated test must use the real fork engine and Rhythm MCP path to create a Worship Calendar, perform an agent state update, then observe the changed scripture/title/theme/service fields through the real hosted-style API contract under the same ID. It must also exercise a human/collaborator update and a deterministic revision conflict. Direct mocked controller calls do not qualify.

### V5 — Flutter correctness, accessibility, and deterministic UI

```bash
cd apps/desktop_flutter
dart format . --set-exit-if-changed
flutter analyze --no-fatal-infos
flutter test test/features/live_artifacts
flutter test
```

Focused tests must include semantics labels/traits, full title announcement with visual truncation, Tab/Shift-Tab/Left/Right/Enter/Space/Escape/Delete behavior, focus return, fixed `+` under narrow overflow, light/dark states, per-tab loading/conflict/deleted/error isolation, Dashboard no-regression, picker type filtering, and close-without-delete. Generate deterministic tab/picker/error goldens with `--update-goldens`, review them, then rerun normally.

### V6 — Real macOS WebView/security and screenshot evidence

Run the macOS integration test against the sandbox API, then capture the actual shipping Flutter window (not a web prototype):

```bash
tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
cd apps/desktop_flutter
flutter test integration_test/live_artifacts_macos_test.dart -d macos
cd ../..
tools/dev/sandbox.sh down
```

One hostile bundle must attempt remote and localhost fetch/XHR/beacon, remote CSS/image/font/script, `file:`, form submission, iframe/object/embed, popup, top navigation, download, undeclared capability, oversized/malformed bridge payload, and forged artifact ID. A loopback request counter plus sentinel state proves zero forbidden requests/effects; the authorized state/PCO operations still succeed. Record native screenshots of Dashboard, overflow/picker, Worship Calendar, conflict, deleted, and error states. Widget mocks/goldens alone do not satisfy this gate.

### V7 — Final review and handoff

```bash
ai-workflow checks --level pr
```

Before any implementation commit, run `gitnexus_detect_changes` with `scope: compare`, `base_ref: main`, and this worktree path. Record exact commands, outputs, screenshots, test database identity (non-secret), sandbox ports, source SHA, and pass/fail in `docs/ai/runs/<date>-live-artifacts.md`. Add manual smoke for keyboard-only and VoiceOver navigation, signed-in user isolation, sharing changes while open, PCO disconnected/denied/offline, and app restart. Draft PR only; no merge or deployment.

## Requirement coverage matrix

| Approved fact | Slice(s) | Acceptance / validation |
|---|---|---|
| 1. Cloud collaborative live artifacts, not files/Gallery | AV-01/02/04 | AC1/AC9; V1/V5 |
| 2. Synology managed bytes + Postgres metadata; no paths | AV-01/02/07 | AC1/AC2/AC11; V1/V3/V7 |
| 3. Private/shared/org editors + CAS/audit | AV-01/02 | AC3/AC4; V1/V3 |
| 4. Versioned UI + separate JSON state + stable latest ID | AV-01/02/03/06 | AC1/AC4/AC8; V1/V4/V6 |
| 5. Shipping Dashboard tabs/picker interaction spec | AV-04/06 | AC5/AC9; V5/V6 |
| 6. Scripts with narrow capabilities; PCO/user integration; normal approvals; scheduling later | AV-05/06 | AC6/AC7/AC10; V2/V6 |
| 7. Worship Calendar replacing Google Sheet | AV-03/06/07 | AC8/AC10; V4/V6/V7 |
| 8. No generic plugin/process sandbox | All | Constraints + closed bridge/API; V1/V2/V6 |
| 9. Gallery/agent_designs remain separate | AV-02/04 | No listed product edit touches Gallery; GitNexus compare in V7 |
| 10. Backend/security/UI/live/a11y/Postgres+SQLite gates; no destructive migration | AV-07 | AC11/AC12; V1–V7 |

## Dependencies

1. AV-01 schema/storage contract.
2. AV-02 hosted API/auth/CAS foundation.
3. AV-03, AV-04, and AV-05 in parallel after AV-02.
4. AV-06 after the Flutter shell and capability endpoint exist.
5. AV-07 only after every behavioral slice is complete.

External dependencies are limited to the already-used PCO integration and one official Flutter WKWebView package. The PCO response path is confirmed in `PcoBrokerController` → `IntegrationsService.ensureFreshPlanningCenterAccount` → named `PlanningCenterService` reads. If the resolved WebView package cannot enforce navigation, popup/download, CSP, and message-channel controls on the repo's macOS target, stop AV-06 and return to design rather than weakening AC6.

## High-risk doubt review

This plan is wrong if WKWebView leaks authenticated origin access despite `connect-src 'none'`, if app-managed bytes are not actually persisted/backed up with `/data`, or if current workspace membership is not the intended organization boundary. The cheapest probes are: the AV-06 hostile loopback counter before UI completion, a sandbox restart plus hosted-volume backup/restore rehearsal in AV-07, and the AV-02 two-workspace authorization matrix. Existing primary sources checked: Flutter package publisher metadata, current PCO service/controller code, Synology compose/deployment docs, and SQLite/Postgres bootstrap code.

## Open questions

None blocking. AJ approved the capability-based model and supplied the V1 product, authorization, interaction, security, use-case, and validation boundaries. Any request to add another capability, background freshness, generic plugin behavior, or broader artifact manager is a new design decision, not scope to infer during implementation.
