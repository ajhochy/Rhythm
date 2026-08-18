# Post-M1 React/Electron parity phases

**Date:** 2026-08-15  
**Status:** Analysis and sequencing only; no implementation authorization  
**Inputs:** `docs/ai/contracts/desktop-parity-matrix.md`, `docs/ai/coverage/react-electron/behaviors.json`, `docs/ai/coverage/react-electron/mappings.csv`, `docs/ai/contracts/engine-session-live-lifecycle.json`, and `docs/ai/runs/2026-08-14-engine-session-live-lifecycle.md`

## Goal and baseline

After Milestone 1 establishes an importable React renderer, a hardened Electron host, fixture/live gateways, packaging, and an integrated gate, deliver desktop parity capability by capability. Each phase below is one independently contractible slice. The sequence is dependency-ordered so a later slice does not invent identity, transport, security, or lifecycle semantics that an earlier slice should own.

The matrix snapshot read for this plan contains 10,868 mappings: 8,492 `retained_unit`, 1,110 `retained_integration`, 472 `manual_check`, 689 `review_required`, and 105 `deferred`. The 689 review-required rows are the actionable review queue; the much larger retained corpus is evidence to preserve, not a request to rewrite every existing test. Counts are a 2026-08-15 snapshot and should be re-read at the start of each future slice because M1 work is still in flight.

The current corpus predates direct `apps/electron/**` coverage, so no mapping has an Electron source prefix. In the tables below, **mapped** surfaces are what the CSV currently proves; **delivery** surfaces name the React/Electron target and any known parity source not yet represented. `imported_web` in the CSV is called **web** here. Documentation, root, MCP-server, and tools rows contribute to counts but are not repeated as product surfaces because the requested surface vocabulary is Flutter / API / web / Electron / mobile / `opencode_fork`.

Clarification interview was skipped: the requested artifact, behavior set, evidence types, sequencing requirement, and non-goals were explicit. External prior-art research was also skipped because the authoritative design inputs are the repository's matrix and recorded live-run history.

## The 16 in-scope behaviors

“Review / total” is the current `review_required` count followed by all mappings assigned to the behavior. Zero is meaningful: it identifies a taxonomy seed with no source mapping, not completed parity.

| Behavior | What it covers in this repository | Rough mappings | Product surfaces |
|---|---|---:|---|
| `launch-auth-onboarding` | Cold launch, sign-in/onboarding gates, local API and engine readiness, provider connection entry, and bounded degraded startup. | 14 / 123 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron. |
| `nav-a11y` | App shell navigation, keyboard/focus order, semantics, responsive collapse, route selection, and non-mouse operation. | 4 / 32 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron. |
| `dashboard-planner-tasks-rhythms-projects-messages-facilities-automations-integrations` | The eight operational page families, including list/detail/create/edit flows, filters, collaboration, calendar/integration wiring, and the dashboard/planner summaries built from them. | 42 / 576 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron. |
| `profiles-providers-models` | Agent-profile catalog and editing, provider authentication/status, model selection/override, profile persistence, and the resolved profile/model seen by a real engine session. | 0 / 0 | Unmapped gap; proposed span: Flutter, API, web, Electron, mobile, `opencode_fork`. |
| `sessions-composer-attachments-stream-retry-cancel-reconnect-transcript` | Session list/detail/create/delete, composer and attachments, structured streaming, retry/cancel/reconnect, reload persistence, transcript parts, and local-versus-SDK ID handling. | 50 / 1,049 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron and mobile parity review. |
| `permissions-questions-approvals-delegation` | Permission request/reply, question cards, one-time/always decisions, human approvals, denial, delegation identity/status, and parent/child isolation. | 11 / 242 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron and mobile parity review. |
| `files-search-diffs-worktrees` | File mentions/attachments, server-side find, session changes/diffs, worktree creation/selection, branch isolation, and complete worktree cleanup. | 17 / 382 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron and mobile parity review. |
| `mcp-skills-commands` | MCP server configuration/status, skill catalogs/versions/apply flows, slash/custom commands, per-profile allowlists, and deferred MCP dispatch. | 103 / 565 | Mapped: Flutter, API, `opencode_fork`; delivery: web, Electron, mobile. |
| `memory-research-gallery-playbooks-cookbook-schedules-run-quality` | Memory capture/retrieval/provenance/verification, research projects, Gallery, playbooks and cookbook runs, scheduled execution, run status, and quality evidence. | 14 / 145 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron and mobile where an existing mobile surface exists. |
| `notifications` | Notification creation/list/read state, agent-originated notifications, badges, actionable navigation, persistence, and native presentation. | 0 / 16 | Mapped: Flutter, API, `opencode_fork`; delivery: web, Electron, mobile. |
| `live-artifacts` | Artifact list/detail/render, Dashboard tabs and picker, state/bundle revision updates, sharing/ownership, and the constrained capability bridge. | 0 / 1 | Mapped: API only; delivery: Flutter reference, web, Electron. |
| `mobile-pairing-cloud-gateway` | Desktop pairing code/QR, device trust and revocation, paired/cloud transport, project scope, reconnect/reload, and desktop/mobile session continuity. | 17 / 478 | Mapped: Flutter, API, web, mobile, `opencode_fork`; delivery: Electron. |
| `settings-updates` | User/org settings, server/provider preferences, persistence and restart behavior, update availability/action UX, and safe failure states. | 3 / 50 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron and mobile parity review. |
| `electron-windows-dialogs-deep-links-security-process-lifecycle-packaging` | BrowserWindow policy, preload boundary, dialogs, deep links, single-instance/window lifecycle, local child-process ownership, packaged resources, and unsigned package launch. | 8 / 121 | Mapped reference: Flutter, API, web, `opencode_fork`; delivery: Electron. Direct Electron mappings arrive with M1 evidence. |
| `empty-loading-error-offline-forbidden` | Bounded empty/loading/error states across every route; offline/reconnect; unauthorized versus forbidden/not-found handling; redaction; and recovery without fixture fallback. | 406 / 6,983 | Mapped: Flutter, API, web, `opencode_fork`; delivery: Electron and mobile. |
| `ownership-isolation` | Authenticated user/workspace/project/profile/session ownership, non-disclosing cross-scope denial, local/cloud separation, and cleanup that affects only nonce-owned resources. | 0 / 0 | Unmapped gap; proposed span: all six surfaces. |

The phase allocation below sums to all 689 review-required mappings exactly. It also assigns the two zero-row behaviors to an explicit contract instead of silently treating them as complete.

## Dependency-ordered phase sequence

| Order | Slice | Behaviors | Review queue | Depends on | What it unblocks | Size |
|---:|---|---|---:|---|---|---|
| 1 | Desktop entry and host trust | launch/auth, nav/a11y, settings/updates, Electron lifecycle/package | 29 | M1 slices 7–8 complete | A stable packaged host, authenticated renderer origin, navigation, settings boundary, and native seams for every later page. | **M** — four behaviors, but most Electron hardening is M1 evidence reuse. |
| 2 | Profile identity and ownership foundation | profiles/providers/models; ownership/isolation | 0 | Phase 1 | A single identity/config vocabulary for sessions, permissions, MCP scope, cloud data, and mobile pairing. | **L** — both behaviors are unmapped, so the slice must establish the first trustworthy inventory and two-actor contract. |
| 3 | Core operational workspace | dashboard/planner/tasks/rhythms/projects/messages/facilities/automations/integrations | 42 | Phases 1–2 | Real signed-in non-agent work and stable domain gateways needed by notifications, schedules, and cross-feature error coverage. | **L** — eight page families and several API authorization models under one canonical behavior. |
| 4 | Session and transcript lifecycle | sessions/composer/attachments/stream/retry/cancel/reconnect/transcript | 50 | Phases 1–2 | The durable real-engine conversation primitive consumed by permissions, tools, memory/research, and mobile continuity. | **L** — broad UI/WS/API/engine lifecycle plus slow worktree creation and cleanup. |
| 5 | Permissioned agent controls | permissions/questions/approvals/delegation; MCP/skills/commands | 114 | Phase 4; Phase 2 for scope | Safe interactive tool execution and profile-scoped capability discovery for files, research, schedules, and artifact agent actions. | **L** — highest non-resilience review queue and a security-sensitive API/engine boundary. |
| 6 | Files, diffs, search, and worktrees | files/search/diffs/worktrees | 17 | Phases 4–5 | A proven project/worktree substrate for code-oriented sessions, child runs, run-quality evidence, and mobile project views. | **L** — modest review count but real Git state, long-tail timing, and destructive-cleanup risk. |
| 7 | Knowledge runs and notifications | memory/research/gallery/playbooks/cookbook/schedules/run-quality; notifications | 14 | Phases 3–6 | Higher-order workflows that can create sessions, schedule them, publish results, and notify a user without bypassing ownership or approvals. | **L** — many distinct backend services and restart/scheduler behavior despite a small review queue. |
| 8 | Live artifacts in React/Electron | live-artifacts | 0 | Phases 1–3; Phase 5 for agent/MCP writes | Secure artifact rendering and state changes in the new desktop, including Dashboard integration and current-user capability binding. | **L** — near-zero matrix evidence but an existing multi-layer Flutter/API contract and a security-sensitive renderer. |
| 9 | Mobile pairing and cloud continuity | mobile-pairing-cloud-gateway | 17 | Phases 2, 4–6 | A paired phone can safely reuse the now-stable profile/session/project contracts and the Electron host can replace Flutter's desktop pairing role. | **L** — two clients, device trust, gateway transport, restart, and cross-project denial. |
| 10 | Cross-cutting failure-state closure | empty/loading/error/offline/forbidden | 406 | All prior phases | A final parity claim: every completed capability has bounded recovery, redaction, offline behavior, packaged evidence, and an honest matrix disposition. | **L** — 59% of the review queue and intentionally cross-cuts every route and transport. |
| 11 | Signed, notarized, shippable release | (no parity behavior — release engineering) | 0 | Phase 10 | An installable build church staff can actually run. Added by AJ 2026-08-15; Slice 7 shipped an UNSIGNED bundle by design. | **L** — unforgiving, serial, and its failure modes only appear at launch on a clean machine. |

Phases 3 and 4 may begin independently after Phase 2, but their contracts should merge in the numbered order so Phase 5 can consume one stable baseline. Phase 8 can prepare fixture-only UI after Phase 3, but its real agent-update criterion cannot start until Phase 5. Phase 9 cannot start before Phase 4 because pairing without the canonical session lifecycle would create a second session contract. Phase 10 is deliberately last; doing it earlier would hard-code failure states around incomplete behavior.

## Phase contracts and evidence

Each skeleton follows the concise criterion style used by `engine-session-live-lifecycle.json`. A future acceptance-contract step should turn the skeleton into executable RED tests before product work. “Fixture” means deterministic unit/component/Playwright or focused API integration evidence. “Live” means the real API plus the real fork engine in the isolated sandbox, never a mocked controller. “Packaged” means the unsigned `.app` and its packaged renderer/resources, not Vite alone.

### Phase 1 — Desktop entry and host trust

Likely files: `apps/electron/src/main.mjs`, `apps/electron/src/preload.cjs`, `apps/electron/src/policy.mjs`, `apps/electron/test/electron-shell.test.mjs`, `apps/electron/test/electron-unsigned-package.test.mjs`, `apps/web/src/App.tsx`, `apps/web/src/components/Shell.tsx`, `apps/web/src/gateway/context.tsx`, `apps/web/src/styles.css`, `apps/web/tests/shell.spec.ts`, `apps/web/tests/responsive-a11y.spec.ts`, and `apps/web/tests/navigation-validation.spec.ts`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p1-c1` | Cold launch shows one truthful fixture/live/auth readiness state and never exposes application routes before the applicable gate succeeds. | Fixture Playwright state matrix; live API+engine readiness test. |
| `post-m1-p1-c2` | Keyboard and assistive navigation reach every top-level destination with visible focus, stable semantics, and deterministic focus return at narrow and wide sizes. | Fixture accessibility/responsive tests; packaged keyboard/VoiceOver check. |
| `post-m1-p1-c3` | Settings persist through reload/relaunch and update/provider failures render bounded actionable text without raw bodies, secrets, or absolute paths. | Fixture persistence/error tests; packaged relaunch check. |
| `post-m1-p1-c4` | The packaged host enforces the declared renderer origin, preload allowlist, popup/navigation/dialog/deep-link policy, single-instance behavior, and owned child-process shutdown. | Electron unit contract plus unsigned packaged check. |

### Phase 2 — Profile identity and ownership foundation

> **BUILD, not just verify (AJ, 2026-08-15).** This phase's zero review rows do not mean the
> behavior is covered — they mean the matrix is blind to it. Combined with the stale-reference
> problem below, Phase 2 must first BUILD the parity inventory for profiles/providers/models and
> ownership/isolation against the *current* Flutter app, then write criteria against it. Treating the
> zero as "nothing to do" would ship a false parity claim.

Likely files: `apps/web/src/components/Profiles.tsx`, `apps/web/src/components/Inspector.tsx`, `apps/web/src/gateway/index.ts`, `apps/web/src/gateway/sessions.ts`, `apps/api_server/src/routes/agent_configs_routes.ts`, `apps/api_server/src/controllers/agent_configs_controller.ts`, `apps/api_server/src/repositories/agent_configs_repository.ts`, `apps/api_server/src/services/agent_profile_scope.ts`, `apps/api_server/src/services/agent_profile_sync.ts`, `apps/api_server/src/services/opencode_client_service.ts`, `apps/mobile/components/settings/provider-config-dialog.tsx`, and the fork's session/profile allowlist paths under `apps/opencode_fork/packages/opencode/src/session/`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p2-c1` | React/Electron lists, creates, edits, and selects the same profile fields and provider/model identifiers that Flutter and the API persist. | Fixture gateway/component contract; focused API integration test. |
| `post-m1-p2-c2` | A profile/model change survives API restart and a new real engine session resolves the changed canonical `provider/modelId`, not stale cache or display text. | Live API+engine restart test. |
| `post-m1-p2-c3` | Owner, same-workspace non-owner, cross-workspace user, and unauthenticated actor receive the documented profile/config results with non-disclosing denials. | Two-actor fixture/API contract plus live spot check. |
| `post-m1-p2-c4` | Packaged profile/provider UI exposes only safe operations and never renders credentials, raw engine config, or secret-bearing paths. | Packaged profile/settings check with redaction assertions. |

### Phase 3 — Core operational workspace

Likely files: `apps/web/src/pages/{dashboard,planner,tasks,rhythms,projects,messages,facilities,automations,integrations}/`, their matching `apps/web/docs/ai/inventories/*-wiring.md`, `apps/web/tests/contract/issue-2001-dashboard.spec.ts` through `issue-2009-integrations.spec.ts`, `apps/web/tests/pages/*.spec.ts`, `apps/web/src/gateway/tasks.ts`, and the corresponding API controllers/routes/repositories such as `tasks_*`, `projects_*`, `messages_*`, `facilities_*`, `automation_*`, and `integrations_*` under `apps/api_server/src/`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p3-c1` | Each of the eight page families has a declared list/detail/mutation boundary and fixture mode remains deterministic and network-free. | Existing page contracts upgraded to explicit fixture gateway assertions. |
| `post-m1-p3-c2` | Live mode reads and mutates canonical API records without fixture fallback, duplicate parser logic, or cross-workspace visibility. | Focused real-API tests with two actors; engine required only for agent-triggered operations. |
| `post-m1-p3-c3` | Dashboard and planner summaries refresh from successful domain mutations and preserve selection/filter state across reload. | Fixture integration test plus real-API task/project journey. |
| `post-m1-p3-c4` | The packaged app completes one representative create-edit-reload journey for each page family and shows bounded unauthorized/validation feedback. | Packaged page click-through checklist with captured outcomes. |

### Phase 4 — Session and transcript lifecycle

Likely files: `apps/web/src/components/AgentsWorkspace.tsx`, `Composer.tsx`, `SessionRail.tsx`, `Transcript.tsx`, `apps/web/src/store.tsx`, `apps/web/src/sessionState.ts`, `apps/web/src/gateway/sessions.ts`, `apps/web/tests/gateway/sessions-gateway.spec.ts`, `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts`, `apps/api_server/src/controllers/agent_sessions_controller.ts`, `apps/api_server/src/routes/agent_sessions_routes.ts`, `apps/api_server/src/services/ws_gateway.ts`, `apps/api_server/src/services/opencode_stream_bridge.ts`, and `apps/api_server/src/repositories/agent_session_messages_repository.ts`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p4-c1` | Fixture create/compose/attachment/stream/cancel/retry/delete remains deterministic and makes zero live session calls. | Fixture Playwright and gateway tests. |
| `post-m1-p4-c2` | A nonce session created through React/Electron reaches the real provider, renders partial output while working, reaches idle, and persists canonical `input`/`output` transcript parts after reload. | Live API+engine/provider test with measured waits. |
| `post-m1-p4-c3` | Disconnect/reconnect and engine bounce recover the same local session without duplicate prompts, stale fixture content, or local/SDK ID confusion. | Live API+engine reconnect test. |
| `post-m1-p4-c4` | Hard delete removes the local and SDK session and cleanup leaves zero nonce rows, files, listeners, worktrees, and branches on pass or failure. | Live cleanup assertions including `git worktree list` and branch checks. |

### Phase 5 — Permissioned agent controls

Likely files: `apps/web/src/components/ToolWorkspace.tsx`, `apps/web/src/components/Transcript.tsx`, `apps/web/src/components/Composer.tsx`, `apps/api_server/src/services/ws_gateway.ts`, `apps/api_server/src/controllers/agent_approvals_controller.ts`, `apps/api_server/src/controllers/agent_delegation_controller.ts`, `apps/api_server/src/routes/agent_approvals_routes.ts`, `apps/api_server/src/routes/agent_delegation_routes.ts`, `apps/api_server/src/routes/opencode_mcp_routes.ts`, `apps/api_server/src/routes/opencode_skills_routes.ts`, `apps/api_server/src/security/human_approval_security.ts`, `apps/mobile/components/chat/chat-cards.tsx`, `apps/mobile/components/settings/mcp-section.tsx`, and the fork's MCP/permission resolution under `apps/opencode_fork/packages/opencode/src/session/`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p5-c1` | Permission and question requests render typed choices, send exactly one scoped reply, survive reconnect, and distinguish one-time from persisted always decisions. | Fixture card/WS tests; live API+engine permission roundtrip. |
| `post-m1-p5-c2` | Human approval and delegation preserve caller, owner, parent/child, workspace, and profile scope; unauthorized replies or status reads fail non-disclosingly. | Focused API security tests plus two-actor live delegation test. |
| `post-m1-p5-c3` | Profile-scoped MCP and skill catalogs expose only allowed entries, and deferred dispatch executes allowed tools while rejecting out-of-scope names. | Fork fixture/integration tests plus live API+engine tool invocation. |
| `post-m1-p5-c4` | Packaged Electron supports the permission/question/approval and MCP/skill/command journeys without exposing raw schemas, credentials, stack traces, or arbitrary backend errors. | Packaged interaction and redaction check. |

### Phase 6 — Files, diffs, search, and worktrees

Likely files: `apps/web/src/components/Composer.tsx`, `apps/web/src/components/Inspector.tsx`, `apps/web/src/components/ToolWorkspace.tsx`, `apps/api_server/src/routes/opencode_worktrees_routes.ts`, `apps/api_server/src/__tests__/issue_1058_isolate_worktree.test.ts`, `apps/api_server/src/__tests__/issue_1060_file_find_proxy.test.ts`, `apps/api_server/src/__tests__/live_e2e_1057_worktree.test.ts`, `apps/api_server/src/__tests__/opc_m3_1_changes_tab_diff.test.ts`, `apps/api_server/src/__tests__/opc_m4_1_file_attachments.test.ts`, and the fork worktree/diff/session implementation under `apps/opencode_fork/packages/opencode/`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p6-c1` | Composer file references and attachments preserve filename, MIME, size limits, and project scope, and a real agent can read the intended nonce content only. | Fixture attachment tests; live API+engine file-read test. |
| `post-m1-p6-c2` | Search and diff views return normalized project-scoped paths and content while rejecting traversal, foreign project IDs, and secret-bearing absolute paths. | Focused API integration/security tests; packaged view check. |
| `post-m1-p6-c3` | Isolated session creation produces the requested worktree/branch, agent edits land there while main stays unchanged, and the UI exposes the resolved workspace. | Live API+engine+Git behavioral test with a realistic create window. |
| `post-m1-p6-c4` | Success, timeout, cancel, and failure cleanup remove every nonce worktree and branch as well as database/files/listeners without touching pre-existing worktrees. | Live failure-path cleanup test using Git's worktree registry and branch list. |

### Phase 7 — Knowledge runs and notifications

Likely files: the relevant React pages/components added under `apps/web/src/`, `apps/api_server/src/repositories/agent_memory_repository.ts`, `agent_research_repository.ts`, `agent_cookbook_repository.ts`, `agent_scheduled_tasks_repository.ts`, `agent_scheduled_task_runs_repository.ts`, `notifications_repository.ts`, `apps/api_server/src/services/agent_delegation_service.ts`, `gap_discovery_scheduler.ts`, `apps/api_server/src/controllers/notifications_controller.ts`, `notifications_agent_controller.ts`, `apps/api_server/src/routes/notifications_routes.ts`, `notifications_agent_routes.ts`, and existing live contracts such as `research_projects_live_e2e.test.ts`, `live_e2e_memory_*.test.ts`, and `issue_740_cookbook_run.test.ts`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p7-c1` | Memory capture, retrieval, provenance, verification, update, and forget operations round-trip canonical IDs and remain scoped to the authorized actor/session. | Focused fixture/API contracts plus real engine memory retrieval test. |
| `post-m1-p7-c2` | Research, Gallery, playbook, cookbook, and scheduled runs create observable run records, output or bounded failure, and resume/recover according to their existing contracts. | Fixture state tests plus serial live API+engine run tests. |
| `post-m1-p7-c3` | Scheduled and delegated execution honors profile/permission/ownership gates after restart and never fires copied or disabled sandbox work. | Live sandbox restart/scheduler test. |
| `post-m1-p7-c4` | Completion/failure notifications persist unread/read state, navigate to the owned target, and appear in packaged Electron without cross-user disclosure or duplicate delivery. | Fixture/API notification tests; packaged native/in-app notification check. |

### Phase 8 — Live artifacts in React/Electron

> **BUILD, not just verify (AJ, 2026-08-15).** Same as Phase 2: zero mapped rows is a blind spot, not
> coverage. Live artifacts must be inventoried against the current Flutter implementation under
> `apps/desktop_flutter/lib/features/live_artifacts/` before criteria are written, because the
> reference has moved since the matrix was scanned.
>
> **Superseded in part, 2026-08-15.** The "zero mapped rows" figure was a classifier bug, not a
> blind spot: `\blive artifact\b` could never match `live_artifacts_*` because `_` is a word
> character. After the fix, `live-artifacts` carries **78 mappings**. The BUILD instruction may still
> be right for the React/Electron side, but re-derive it from the corrected corpus instead of from
> the zero. `profiles-providers-models` and `ownership-isolation` really are still 0, so Phase 2's
> BUILD framing is unaffected.

Likely files: new React artifact UI/gateway modules under `apps/web/src/`, `apps/web/src/pages/dashboard/`, `apps/api_server/src/models/live_artifact.ts`, `apps/api_server/src/repositories/live_artifacts_repository.ts`, `apps/api_server/src/controllers/live_artifacts_controller.ts`, `live_artifact_capabilities_controller.ts`, `apps/api_server/src/routes/live_artifacts_routes.ts`, `apps/api_server/src/services/live_artifact_storage.ts`, `apps/api_server/src/__tests__/live_artifacts*.test.ts`, and the reference Flutter implementation under `apps/desktop_flutter/lib/features/live_artifacts/`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p8-c1` | Electron Dashboard lists, opens, closes, and restores stable artifact tabs without deleting artifacts or regressing the fixed Dashboard content. | Fixture React tests; packaged tab/picker check. |
| `post-m1-p8-c2` | Private/shared/organization reads and revision-checked state/bundle updates match the existing API authorization and CAS contract with no storage-path disclosure. | Focused API integration/two-actor tests. |
| `post-m1-p8-c3` | A real scoped agent updates a nonce artifact through the existing MCP/API path and Electron observes the same stable ID and revision after reload. | Live API+engine/MCP test plus packaged observation. |
| `post-m1-p8-c4` | The Electron renderer permits only declared artifact operations and blocks remote/local network, file, popup, navigation, download, forged ID, and oversized bridge attempts. | Packaged hostile-artifact check with loopback/sentinel evidence. |

### Phase 9 — Mobile pairing and cloud continuity

Likely files: Electron pairing UI/preload additions under `apps/electron/src/` and `apps/web/src/`, `apps/api_server/src/controllers/mobile_gateway_controller.ts`, `apps/api_server/src/routes/mobile_gateway_routes.ts`, `apps/api_server/src/services/mobile_pairing_service.ts`, `apps/api_server/src/services/mobile_project_scope.ts`, `apps/api_server/src/middleware/mobile_device_auth.ts`, `apps/mobile/app/pair.tsx`, `apps/mobile/components/settings/paired-mac-section.tsx`, `apps/mobile/lib/transport/paired-mac-client.ts`, `apps/mobile/providers/services/mobile-gateway-service.ts`, and `apps/api_server/src/__tests__/issue_1166_*`, `issue_1175_*`, and `issue_1279_mobile_gateway_live.test.ts`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p9-c1` | Packaged Electron creates an expiring pairing offer that the mobile client accepts once, displays the expected host fingerprint, and can revoke. | Fixture desktop/mobile contract; packaged desktop plus mobile acceptance check. |
| `post-m1-p9-c2` | A paired device lists and resumes only authorized projects/profiles/sessions and cross-project or external-share IDs fail non-disclosingly. | Two-project live gateway isolation test. |
| `post-m1-p9-c3` | Prompt, stream, reconnect, reload, attachment/diff, and child-session behavior reuse the canonical desktop session schema without a mobile-only role or ID dialect. | Live API+engine+mobile gateway test. |
| `post-m1-p9-c4` | Restart and offline recovery preserve only intended device metadata, rotate/expire capabilities correctly, and leave zero nonce devices, sessions, worktrees, branches, files, or listeners. | Serial live restart/failure-path test with complete cleanup audit. |

### Phase 10 — Cross-cutting failure-state closure

Likely files: all completed React gateway/page modules under `apps/web/src/`, `apps/web/tests/parity-edge-cases.spec.ts`, `apps/web/tests/resilience-map-a11y.spec.ts`, `apps/web/tests/tool-state-matrix.spec.ts`, `apps/web/tests/gateway/invalid-live.spec.ts`, `apps/electron/src/policy.mjs`, API error middleware and route contracts, plus the parity artifacts and validator under `docs/ai/coverage/react-electron/` and `tools/validation/`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p10-c1` | Every in-scope route declares and renders deterministic empty, initial-loading, retrying, success, forbidden/not-found, offline, and terminal-error states without fixture fallback. | Fixture state-matrix tests across all routes. |
| `post-m1-p10-c2` | Real API/engine disconnect, slow response, restart, malformed event, and authorization failure recover or fail boundedly without duplicate mutation, stale identity, raw body, secret, stack, or absolute-path disclosure. | Serial live fault-injection tests with measured timeouts. |
| `post-m1-p10-c3` | The unsigned packaged app can launch offline, reconnect, relaunch, and restore only persisted authorized state while all native/renderer boundaries remain enforced. | Packaged offline/reconnect/relaunch check. |
| `post-m1-p10-c4` | Every one of the 689 baseline review rows receives a reviewed retained/manual disposition or an explicit still-planned owner, Terminal alone remains deferred, and a contaminated working tree produces the same hermetic scan. | Matrix validator/freshness check after fixture/live/package evidence; contamination-order check. |

### Phase 11 — Signed, notarized, shippable release

Added by AJ 2026-08-15. Slice 7 deliberately produced an UNSIGNED bundle; nothing in the parity
program made the app distributable. Runs after Phase 10, because shipping a build whose failure
states are unproven is how a bad release reaches church staff.

Likely files: `.github/workflows/` (a new Electron release workflow alongside `desktop_release.yml`),
`tools/release/sign_and_notarize_macos.sh` (the Flutter path is the working reference),
`apps/electron/scripts/package-mac.mjs` (extend the unsigned packager rather than replacing it),
`apps/electron/package.json`.

| Criterion ID | One-line acceptance | Required evidence |
|---|---|---|
| `post-m1-p11-c1` | One command produces a Developer ID-signed, hardened-runtime `.app` from the existing unsigned packager, with every embedded binary and framework signed. | `codesign --verify --deep --strict` plus `spctl --assess` output. |
| `post-m1-p11-c2` | The signed bundle is notarized and stapled, and launches on a machine that has never seen it without Gatekeeper prompts. | Notary submission log, `stapler validate`, clean-machine launch evidence. |
| `post-m1-p11-c3` | The release pipeline runs in CI from a version tag, never reuses an existing tag, and publishes a DMG. | CI run against a fresh tag; rejection evidence for a duplicate tag. |
| `post-m1-p11-c4` | The packaged live smoke (`slice-7-c4`) still passes against the SIGNED bundle, so signing does not break the runtime contract. | Signed-bundle rerun of the Slice 7 packaged suite. |
| `post-m1-p11-c5` | No signing secret, certificate, profile, or credential is committed, logged, or embedded in the artifact. | Secret-scan of the artifact and CI logs; `.gitignore`/secret-name inventory. |

Known traps, all previously hit in this repo:
- Copying or modifying `Electron.app` invalidates its signature; on Apple Silicon it will not launch
  until re-signed. Slice 7 handles this with an ad-hoc signature — Phase 11 replaces that with a real
  Developer ID signature, and must re-verify, not assume.
- A restricted entitlement without an embedded provisioning profile causes an AMFI `SIGKILL` at
  launch despite green CI and successful notarization (v0.18.53 shipped DOA this way).
- Every `$(...)` Xcode variable must be expanded at re-sign time.
- The Apple Development certificate expires annually and drops out of `find-identity` while still
  existing; check `openssl x509 -checkend 0` first.

**Size: L.** Signing and notarization are unforgiving and mostly serial, and the failure modes above
only appear at launch on a clean machine.


## Capability inventory before every phase (2026-08-15, after the Phase 1 sign-in miss)

**Every phase gets a Flutter-vs-React capability inventory before its contract is written — not only
the phases whose review-row count is zero.**

Phase 1 was declared complete with 15 passing criteria while React had **no Google sign-in at all**,
against a Flutter desktop app with a full PKCE OAuth client
(`apps/desktop_flutter/lib/app/core/auth/desktop_google_oauth_client.dart`). Three failures compounded:

1. **The corpus counts test declarations, not capabilities.** `launch-auth-onboarding` showed 14
   review rows across 123 mappings, which only means 123 lines mention auth-ish words. A missing
   feature leaves no line to count, so no scan of this kind can ever surface one.
2. **The criteria set was never checked back against the behaviour description.** This plan's own text
   for that behaviour reads "Cold launch, **sign-in/onboarding gates**, local API and engine
   readiness…". When it became 18 executable sub-criteria the sign-in half silently dropped out.
   Individual criteria were audited against the real surface; the *list* was not audited against the
   sentence it came from.
3. **Only zero-row phases were told to BUILD an inventory.** Phases 2 and 8 got one because their
   counts were 0. Phase 1 had non-zero rows, so it looked mapped and got none. Non-zero counts bought
   false confidence — exactly backwards, since mapped rows prove tests exist, never that behaviour does.

The remaining phases all have non-zero rows (P5 alone has 217), so without this change the same trap
fires six more times.

Each phase inventory must lead with **the list of capabilities Flutter has and React does not**, cited
`file:line` on both sides, read from `origin/main` because Flutter is the reference and this branch is
pinned older. That list becomes additional contract criteria; the plan's per-phase criteria are a
floor, not a ceiling.

## Decisions taken by the orchestrator (AJ delegated, 2026-08-15)

AJ's direction: "My decision was migrate to react — your job is make it work." These were decided
without escalation and are recorded here so they are auditable rather than implicit.

- **The shipping package runs in live gateway mode** (AJ, explicit). The server address is resolved at
  runtime and the session token comes from Google sign-in — never compiled into the artifact.
- **Phase 2 asserts the ownership contract that exists** rather than inventing a workspace model:
  `agent_configs` has no owner/workspace/project column, so profiles are global-per-install by design.
  The missing per-user ownership is recorded `not_tested` with a re-open condition instead of being
  quietly satisfied or speculatively built into the shipping API.
- **Phase 8's "near-zero matrix evidence" premise is void** — that was the `categoryFor` bug;
  `live-artifacts` carries 78 mappings. Phase 8 is re-derived from the corrected corpus like any other
  phase, via its capability inventory.
- **The hard-delete `204` with a failed engine `removeWorktree` (400) folds into Phase 6**, which owns
  worktree cleanup, rather than becoming a stray follow-up.
- **No criterion is assigned to AJ as manual homework** unless it is genuinely unautomatable. Packaged
  keyboard traversal and packaged relaunch persistence are scriptable and belong to the orchestrator.
- **Phase 11 (signing/notarization) was initially deferred, then attempted after AJ pointed at real
  local credentials** (`~/Documents/Certificates & Keys/`) and directed the build/launch/test/PR
  sequence explicitly (2026-08-17). c1/c2 do NOT require CI secrets after all — AJ has a real
  Developer ID Application identity and App Store Connect notary API key on this machine; codesign
  and `xcrun notarytool` work locally. Built `apps/electron/scripts/sign-and-notarize-mac.mjs`
  (entitlements at `apps/electron/entitlements/mac.plist`) modeled on
  `tools/release/sign_and_notarize_macos.sh`, simplified because this Electron shell bundles no
  native runtime/opencode fork binary. First notarization attempt was correctly REJECTED by Apple
  (`chrome_crashpad_handler` and Squirrel's `ShipIt` — two extensionless Mach-O helpers my walker's
  extension-based matching missed); fixed by detecting Mach-O magic bytes instead of relying on file
  extension, re-signed, and Apple accepted it (`status: Accepted`, stapled, `spctl --assess` →
  `accepted`/`source=Notarized Developer ID`). `slice-7-c4`'s packaged live-smoke test (real gateway
  read against the sandbox) passes against this signed bundle, confirming post-m1-p11-c4. A CI
  workflow (`.github/workflows/electron_release.yml`) is authored for c3 but not dispatched — running
  it for real still means publishing an actual GitHub Release, which stays gated on AJ triggering it
  himself. c5 (no secret committed) holds: nothing under `apps/electron/` references a literal key,
  password, or cert; the workflow reads everything from `secrets.*`.

## Stale reference warning (AJ, 2026-08-15)

The matrix was scanned against `9d8c4443`. `origin/main` is already ahead by a commit touching
**17 `apps/desktop_flutter` files (+1341 lines)**, and Flutter is the parity REFERENCE. Every row in
the corpus therefore describes an app state that has already moved.

Consequences, which apply to the whole program and not only to Phases 2 and 8:
- Before each phase begins, re-base onto current `main` and re-run
  `node tools/validation/generate-desktop-parity-matrix.mjs`, then diff the corpus. New or changed
  Flutter behavior is new parity work, not drift to be normalized away.
- A phase that scores itself against a stale corpus produces a false parity claim. The 689-row
  baseline is a reconciliation reference, not a fixed target.
- Phases 2 and 8 are the acute cases: they must BUILD the inventory for behaviors the matrix cannot
  currently see, against the current Flutter app.


## Progress weighting (AJ, 2026-08-15)

Post-M1 progress is weighted by VOLUME OF WORK, not by phase count, because the phases are wildly
unequal. Weighted units = review-required rows, plus an explicit allowance for the three phases that
carry real work but zero mapped rows.

**Re-based 2026-08-15 after three generator corrections.** The numbers below replace an earlier
839-unit table whose shape was an artifact of a broken classifier, not of the work.

| Phase | Units | Share |
|---|---:|---:|
| P1 desktop entry / host trust | 58 | 6.8% |
| P2 profile identity / ownership (BUILD) | 50 | 5.8% |
| P3 core operational workspace | 59 | 6.9% |
| P4 session / transcript lifecycle | 60 | 7.0% |
| P5 permissioned agent controls | 217 | 25.3% |
| P6 files / diffs / search / worktrees | 26 | 3.0% |
| P7 knowledge runs / notifications | 18 | 2.1% |
| P8 live artifacts (BUILD) | 50 | 5.8% |
| P9 mobile pairing / cloud continuity | 24 | 2.8% |
| P10 cross-cutting failure states | 246 | 28.7% |
| P11 sign / notarize / ship | 50 | 5.8% |
| **Total** | **858** | |

708 units are real review-required rows. The remaining 150 are allowances of 50 each for P2, P8, and
P11 — all L-sized: P2 must BUILD an inventory the matrix is genuinely blind to (`profiles-providers-models`
and `ownership-isolation` are still 0 mappings after every correction below), and P11 is release
engineering rather than parity.

**What changed and why the shape moved.** Three corrections to
`tools/validation/generate-desktop-parity-matrix.mjs`, none of which changed the total review queue:

1. **Flutter is now read from `origin/main`**, not this branch, because Flutter is the parity
   reference and had moved (AJ, 2026-08-15). Fails loudly on an unresolvable ref; never falls back to
   the working tree; stamps the resolved SHA into `behaviors.json`.
2. **`categoryFor` matched stems with a trailing `\b`, which is dead against `_` and plurals.**
   `facilit` could never match `facilities`, `\bnotification\b` never matched the `notifications/`
   directory, and `\blive artifact\b` never matched `live_artifacts_*`. Real coverage was silently
   scoring into the catch-all bucket. Fixing it moved 175 review rows out of
   `empty-loading-error-offline-forbidden` and, most consequentially, took `live-artifacts` from
   **1 mapping to 78**.
3. **`apps/electron` was not a scanned surface at all**, which is why this plan originally recorded
   that no mapping had an Electron source prefix. M1 shipped the shell, the package, and their
   suites, so the surface is now scanned (14 rows, all retained test declarations).

Consequences that change how the program should be read:

- **Phase 10 is ~29%, not 48%.** It is still the largest single block but no longer half the program.
- **Phase 5 is ~25% and is now the second-largest block**, mostly from `mcp-skills-commands` rising
  104 → 195. It is also the most security-sensitive slice, so its size and its risk now agree.
- **Phase 8's premise needs revisiting.** "Near-zero matrix evidence" was a classifier artifact:
  `live-artifacts` has 78 mappings. The BUILD framing may still hold for the React/Electron side, but
  it must be re-derived against the real corpus rather than assumed from a zero.
- The M1-to-post-M1 split stays 36/64; there is no honest metric spanning both, because M1 was not
  parity work and carries zero review rows.

## Risk register

These risks come directly from the Slice 4 lifecycle history and apply even when a phase appears to be “just UI.”

| Phase | Known traps and required controls |
|---|---|
| 1 | **Mutable evidence contamination:** packaged/Playwright output (`test-results`, `playwright-report`, `.agent-stack`) can make the parity freshness check order-dependent. Keep generated/run output excluded and prove clean → contaminated → clean equivalence. Do not let a packaged smoke mutate the corpus it validates. |
| 2 | **Wrong schema literals:** distinguish display/provider/engine vocabulary from canonical persisted vocabulary; confirm `provider/modelId`, local ID, SDK ID, and profile ID from types and observed responses before locking assertions. **Cache/restart:** prove a new engine session after the write; a function-call assertion cannot detect stale config caches. |
| 3 | **False fixture green:** imported pages already have rich fixtures and wiring inventories, so a visually complete page can still make no live call. Every live criterion must observe canonical API rows and actor scope. Keep documentation/manual rows from being promoted to UI automation without evidence. |
| 4 | **Fast-system waits:** `createWorktree` was measured at 61.151s; a 4s/5s/60s observer produced false failures. Measure the blocked stage and widen observation patience without weakening predicates. **Role literal:** engine `assistant` maps to persisted `output`; contracts must assert canonical storage. **Leak blind spot:** zero DB/files/listeners did not detect leaked Git worktrees/branches. |
| 5 | **Engine/API dialect drift:** permission, question, and MCP schemas cross renderer → WS/API → fork. Lock assertions to canonical translated shapes, not raw engine literals. **Cold dispatch patience:** the provider request required a 120s poll in Slice 4; timeouts must reflect actual cold engine/tool dispatch and still retain nonce/exact-count assertions. |
| 6 | **Git cleanup is its own state system:** two `smoke-*` worktrees and branches survived a “zero leaks” report. Check `git worktree list`, filesystem existence, and branch refs separately; remove only nonce-owned targets. Concurrent Git activity can delay `git worktree add`, so do not classify a wait timeout as missing product code without measurement. |
| 7 | **Long-running work:** research/schedule/cookbook phases can outlive generic Playwright expectations. Separate accepted, running, completed, and persisted observations; use serial stateful live suites. **Cleanup masking:** cleanup failures must not hide the primary assertion, but every cleanup action should continue and be reported. |
| 8 | **Hermetic and security evidence:** hostile-artifact screenshots/reports are mutable evidence and must remain outside the parity corpus. Assertions must use public revision/role/visibility literals rather than storage or framework names. Cleanup must include artifact bytes and any agent session/worktree used to update them. |
| 9 | **Multi-process timing:** mobile gateway, API, engine, packaged Electron, and phone client have independent readiness/reconnect windows. Set barriers from observed health/boot identity, not sleeps. **Isolation:** zero local rows is insufficient; also check paired-device records, gateway listeners, engine sessions, files, worktrees, and branches. |
| 10 | **The scan can test itself accidentally:** Slice 4 first reported 5/6 only because Playwright output entered the hermetic corpus. Run the final check against both clean and deliberately contaminated generated-output states. **No semantic guessing:** confirm canonical error/status/role literals from types and observed API payloads before encoding the cross-route matrix. |

Global controls for every phase:

- A longer wait is acceptable only when the observable predicate stays equally strict and timing is supported by measurement; do not use extra waiting to paper over an impossible schema predicate.
- Live cleanup belongs in `finally`, uses a standalone request context where needed, continues after individual cleanup failures, and rethrows the primary failure.
- Cleanup inventories must cover database rows, auth/config restoration, files/artifacts, listeners/processes, engine sessions, Git worktrees, and branches. “Zero leaks” means all applicable systems, not just SQL counts.
- Run notes and `docs/ai/project-state.md` report executions; they do not declare parity checks and must never become input evidence merely because they contain words such as “verify” or “acceptance.”
- Stateful live specs run serially and use nonce-owned resources. A future implementation must use the isolated sandbox lifecycle only; it must never hand-start a second API server or touch the live app's ports.

## Explicitly out of scope

- **Terminal/PTTY parity is deferred.** `behavior:terminal-pty` is the only taxonomy record with `status: deferred`, and its 105 mappings are the only deferred rows. A real PTY contract needs interactive byte streaming, resize, signals, process-group ownership, reconnect/backpressure, shell/environment policy, and guaranteed child cleanup. The existing one-shot shell/command surfaces do not prove those semantics, so folding Terminal into files or commands would create a false parity claim.
- M1 slices 7 and 8 are not redesigned here. Unsigned packaging and the integrated M1 gate must finish first; Phase 1 consumes their evidence.
- This plan does not authorize code, branches, commits, pushes, PRs, production deployment, or migration execution. Signing/notarization moved IN scope as Phase 11 (AJ, 2026-08-15); it remains gated on AJ's explicit approval per release, and this plan does not authorize executing a release.
- It does not redesign the canonical Flutter or API product. Flutter remains the shipping reference during this parity program; API or fork changes belong in a phase only when its RED contract proves a real missing shared behavior rather than a React adapter gap.
- It does not expand the mobile product beyond the existing pairing/cloud-gateway behavior. Mobile is otherwise a parity source or consumer, not a second desktop implementation target.
- It does not convert all 10,868 mappings into Playwright tests. Retained unit/integration evidence stays retained when it proves the behavior; manual checks remain manual where native/subjective evidence is required; only the 689 review rows require disposition review.
- It does not treat generated artifacts, mutable run notes, project state, screenshots, traces, or postmortems as declarations of coverage.
- It does not permit destructive schema changes or production-data cleanup. Any shared API persistence work remains additive and must preserve SQLite/Postgres parity and the production manual-review gate.

## Immediate handoff after M1

Start with Phase 1's contract, not implementation. Re-read the matrix after Slice 8, incorporate direct Electron source rows from the finished M1 artifacts, and preserve the 689-row baseline as the reconciliation reference. Then create executable failing criteria for `post-m1-p1-c1` through `c4`, using the M1 package and shell contracts as retained evidence rather than duplicating them. Phase 2 is the first new parity inventory: it must explicitly map `profiles-providers-models` and `ownership-isolation`, because their current zero-row counts are coverage gaps, not zeros to celebrate.
