# Electron replacement and Flutter retirement — execution plan

Date: 2026-09-10
Status: execution authorized; bounded Phase 0 baseline, capability inventory and isolated sandbox bootstrap complete; product implementation not started
Planning owner: workflow manager; AJ approved full-feature usability design, parallel execution, synthetic fixture, Apple Silicon **and** Intel.
Execution checkout: `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`, branch `feature/electron-flutter-retirement`.
Clean replacement base: `0bc46a5ece1a937c484c0054493c75b0299eafef`.

## Provenance and current baseline

Deliberately transferred and amended from the manager-owned source at `/Users/ajhochhalter/Documents/Rhythm/docs/ai/plans/2026-09-10-electron-flutter-retirement.md`. That checkout is not modified. This is the execution copy, retaining the manager's D01–22 decisions, E00–63 units and Phase 0–6 gates, with approved E00/E01 amendments integrated below. Lane A and Lane B reports, as supplied in the dispatch, are authoritative source-checked planning inputs, not new runtime results.

The original audit checkout was `feature/org-reviewer` at `92e46517`. It is **not** the replacement base. Exclude Org Reviewer PR #1492 commits; do not import that branch's work. Lane A establishes all three current source references at `0bc46a5ece1a937c484c0054493c75b0299eafef`: clean base, shipping Flutter `v0.18.62`, and latest Electron prerelease `electron-v0.18.63`.

| Reference | Release ID | Artifact | SHA-256 (Lane A release metadata) |
|---|---|---|---|
| Flutter `v0.18.62` | 378141242 | DMG | `e1f7a33492e583e76d4e17b1fb91d4e794b8dc73e463f3a405308b5af0c875d8` |
| Flutter `v0.18.62` | 378141242 | ZIP | `e4375a0d22d4031146d99990ac5f246ddd607827f1a5666ba592d211b30ee762` |
| Electron `electron-v0.18.63` (prerelease) | 378137782 | `Rhythm.zip` | `bd2016462bf2bb05bdc1371163f165b03be5ddd0c46107e219da3d7ca030e243` |

Metadata only: these artifacts were not downloaded or hashed by this doc lane. Source identity, release metadata, installed version and current runtime qualification are separate evidence. Hardware inventory still must record actual fleet, model/CPU architecture, macOS version, installed Flutter/Electron versions and artifact identity. Both Apple Silicon and Intel qualification legs remain mandatory regardless of the discovered fleet; absence of either environment blocks qualification, not scope.

The five original review families are SHELL-1–10, AGENT-1–14, UX-1–16, PARITY-1–14 and HIST-01–21: review identifiers, not filed issues. Original source findings and historical runtime reports retain their provenance. The audit GitNexus index was two commits stale and unavailable to some reviewers; do not relabel those findings graph-verified. Preserve historical contracts/runs; they are not current replacement acceptance. Current job ledger: [user-job-matrix.md](../coverage/react-electron/user-job-matrix.md). Documentation contract: [electron-phase0-baseline.json](../contracts/electron-phase0-baseline.json).

## Goal and selected approach

Make Electron the complete, dependable Rhythm desktop client, migrate existing Flutter users without losing data or capabilities, and retire Flutter only after a current signed candidate passes replacement qualification. Incrementally repair the existing Electron shell and React workbench, retaining typed API/engine integration; no renderer rewrite, embedded upstream OpenCode UI, pixel-parity requirement or reduced-feature launch. Implementation, deployment, default-client cutover and retirement are separate authorizations.

All reachable Flutter jobs remain in scope. An endpoint or plausible fixture is not a usable job. Missing upstream primitives must be unavailable with a reason, never simulated. Session sharing has **UNKNOWN Flutter reachability**, but recipient review/share/revoke remains an **AJ-selected Electron product requirement**, not claimed Flutter parity. Dashboard goal progress/health readout is source-confirmed; goal create/edit/manage reachability is **UNKNOWN**. Do not invent a management route or standalone Goals product; resolve evidence before declaring completeness.

### Flutter maintenance-first policy

Flutter remains shipping and maintained throughout replacement. Critical, security and user-blocking fixes continue; new Flutter features require explicit approval. Every merged Flutter or shared behavior change must reconcile this plan's job matrix before that change is closed, including intended Electron outcome, owner, test mechanism and required evidence. Every phase gate compares against the **latest shipped Flutter release/artifact**, not only today's baseline, and records new SHAs/digests and reconciled drift. This does not import excluded PR #1492 commits.

## Product decisions — resolved

| ID | Decision | Required behavior |
|---|---|---|
| D01 | Workbench, not pixel parity | Preserve routes, inspectors, retained artifact panes, textual status, native HTML controls and teal/light/dark tokens; readable secondary text, no rebrand. |
| D02 | Deterministic Flutter-semantic ordering | Default Newest; Oldest, Name, Activity, Status. Parse timestamps; activity uses canonical lastActivityAt then createdAt. Status uses working/starting/idle/error/closed/resumable, not display labels. Stable local-ID ties; account/scope-specific persisted preferences. |
| D03 | Context without forced density | Default two-line rows with project/parent and text status; compact preference. No invented pinning. Same comparator for roots/siblings; matching children discoverable without matching parents. |
| D04 | Complete stored history | Bounded initial load, stable cursor for older roots, explicit search/filter semantics beyond 100 roots; descendant continuation/load-more, no silent loss. E20 owns UI; E26 owns local API contract. |
| D05 | Closed is not archived or resumable | Preserve category, archivedAt, preview, activity and IDs. Closed in main collection; Scheduled, Background, Archived and Resumable are distinct real-loading views. SDK recovery only when supported. |
| D06 | Truthful controls | Live persisted established actions; unavailable controls disabled with reason. Bulk Cancel clears selection without stopping anything; separate named and confirmed Stop selected. |
| D07 | Complete identity/configuration | Real provider/model/engine-agent/account catalogs; once-only turn overrides versus durable session defaults. Default profile, duplicate, managed skills, permissions, delegation and auto-approval round-trip. |
| D08 | Installation-wide local profiles | Preserve shared-installation profile scope; no owner migration. Label scope, enforce authorization, isolate per-user preferences/credentials. Cloud scope is separate product work. |
| D09 | Interactive local children | Resolve local child first; ephemeral SDK views explicitly read-only without composer. Nested back navigation; rail selection clears child context. |
| D10 | Narrow native capabilities | Context isolation, sandbox and closed IPC; authorized open-link, file pick, export/save and clipboard. No general renderer filesystem/process/network bridge. |
| D11 | Rich sessions and selected sharing | Structured tools, interactive permissioned MCP Apps, session artifacts, todos and memory provenance. Review recipients, share/revoke and denied recipient journeys; sharing is AJ-selected, Flutter reachability UNKNOWN. Unsupported direct standalone MCP calls stay unavailable. |
| D12 | Real terminal job — ACTIVATED | Flutter Agents → SessionSidePanel → TerminalTab → PtyTerminalSession reaches real PTY HTTP routes/WebSocket. E27 independently delivers interactive PTY and its eight security/runtime checks. Current Electron terminal is fabricated/not live. E25 retains honest tool shell/run/output/cancel and transcript, **not interactive PTY**. |
| D13 | Complete staff/admin jobs | Facilities groups/series/edit/conflicts; actual member selectors; Planner bulk/order/times; live Messages/notifications; editable Settings/workspace roles/preferences and navigable mobile pairing. Agent Settings cannot remain read-only. |
| D14 | Separate planned date and deadline | scheduledDate is planned work, dueDate the deadline. Group by scheduledDate else dueDate in local date. Undated drag sets scheduledDate only. Import preserves both with explicit preview; explain intentional correction of Flutter's old deadline import behavior. |
| D15 | Existing goals, no invented product | Dashboard goal progress/health and project-step editing; goal management mount UNKNOWN until demonstrated. No fabricated route or standalone Goals destination based on CRUD alone. |
| D16 | Actual-object navigation | Notifications/deep links resolve specific session/thread/task/reservation/artifact; forbidden/missing/deleted targets explain and fall back safely. Preserve auth and unsaved work. |
| D17 | Retain artifact context | Error/unavailable tabs persist with retry/remove, stable IDs and visible preference/share failures. Import into selected authorized workspace, never first artifact's workspace or literal 1. Explain sandbox and content-specific warnings. |
| D18 | Persistent secure login | OS-protected server/account-scoped session with server expiry. Logout/expiry/server change clear caches, queues, panes and main credentials. No queued cross-identity write replay; no invented refresh tokens. |
| D19 | Non-exportable signing | Native non-exportable Keychain P-256 key, Secure Enclave where supported. No private keys in arguments; no silent exportable fallback. Actionable unsupported error; test in dedicated OS account, not just temporary HOME. |
| D20 | Isolated migration/ownership | Separate writable SQLite stores and exclusive owned API/engine; no silent Flutter server adoption. Unknown/incompatible owner yields conflict, never kill. Quiescent backup and explicit handoff. |
| D21 | Both macOS architectures | Apple Silicon **and Intel**, matching fork/Node/addons. Version/update availability and verified signed installer handoff; no silent install during work. Owned update channel plus manual install sufficient initially. |
| D22 | Accessibility is functionality | WCAG 2.2 AA on controlled renderer, keyboard, real VoiceOver, IME-safe send and preserved reading position; third-party content boundary documented, no blanket waiver. |

## Architecture and failure boundaries

- Main owns native capabilities, credentials, signing, runtime identity and child lifecycle; preload exposes closed validated operations only to the owned main frame.
- API is canonical for data/permissions. Hosted operational data stays Postgres; local agent execution/history stays local SQLite. E26 preserves `agentExecutionEnabled` and role/access gates: this is **not** a claim of a direct `dbClient === 'sqlite'` gate, nor a request for hosted Postgres session history.
- DTO adapters preserve stable metadata and IDs. Separate metadata reconciliation, transcript/transient state and outbound writes. Do not implicitly network `store.updateSession` or introduce another state framework.
- Bind every async result/write to originating identity/workspace/session. Auth/server/workspace transitions invalidate state and queued work; stale responses cannot replace current selection.
- Reuse domain gateways, member services and UI primitives. Writes show pending, acknowledged success and retryable failure; optimistic changes reconcile/rollback. Partial imports and destructive previews have explicit semantics.
- File/artifact/MCP resources preserve schema/allowlist/origin/frame/current-user checks. Parity does not authorize bypasses.

## Migration and rollback contract

1. Inventory actual runtime directories, ports, versions, schedules, local/SDK IDs, files, provider references and Keychain ownership. Historical separate ports conflict with current shared-port source: E02 isolated probes determine current runtime facts.
2. Welcome offers Import existing Rhythm data or Start fresh. Show source/destination, backup scope, space and schedules; no silent overwrite.
3. Require Flutter quit and verify owned processes/schedulers stopped. Unknown ownership blocks copying; no kill by port/name.
4. Use SQLite backup/checkpoint-safe operations, not live WAL raw copying. Preserve local/SDK IDs, links, profiles, schedules, project paths, attachments, engine state and preferences. Validate integrity and paths; list inaccessible resources.
5. Separate staging, counts/checksums/integrity validation then atomic promotion; credential-free idempotent receipt. Interruption leaves original source/destination unchanged; retry duplicates nothing.
6. Reauthenticate non-transferable credentials; never copy/expose private signing keys. Imported schedules disabled until review and exclusive scheduler ownership; no double execution.
7. Retain original Flutter store and pre-migration backup for at least 30 days **and** until explicit user deletion approval. No automatic deletion.
8. Rollback stops Electron-owned execution, preserves recovery snapshot/export and checks schemas. Resume Flutter only on untouched compatible original, explaining no automatic backport of post-cutover local work. Candidate rollback preserves new Electron data; no destructive downgrade.

## Execution units and gates

Local IDs are work packages, not filed issues. Each behavioral unit requires its own falsifiable contract and run note before code. API handler changes require API-impact; existing symbols require upstream impact. HIGH/CRITICAL stops for manager review. E00+E01 trivial documentation is batched under one waived doc contract; that waiver **cannot pass Phase0**. Phase 5 prerequisites may start early; no exit is waived.

### Phase 0 — Baseline, capability inventory and evidence repair

| Unit | Ownership / work | Acceptance | Depends on |
|---|---|---|---|
| E00 | Execution plan transfer, current-plan pointer only, baseline contract/run | Exact base/release provenance above; historical claims retained separately, finding families assigned and metadata not called downloaded verification. Preserve superseded contracts without erasing history. No project-state/source-checkout edits in this doc slice. | None |
| E01 | `docs/ai/coverage/react-electron/user-job-matrix.md` | Every named journey and added job has reference mount or UNKNOWN, Electron entry, observable success, owner, existing test mechanism and required evidence tier. All current rows NOT_TESTED/BLOCKED. No route/method/fixture-based acceptance. | E00 |
| E02 | Testing guide, isolated launcher, synthetic fixture and focused bootstrap guards; own contract/run | Synthetic admin/member/session fixture; isolated ports/HOME/XDG/store; login Keychain denied; matching Node ABI; freshly built Rhythm fork selected ahead of stock CLIs; local MCP connected; failures preserve sanitized evidence and teardown touches only owned processes. Web test discovery/network guards, real Keychain and packaged lifecycle are verified at the milestones that use them. | E00 |

Exit: inventory and historical provenance are explicit; the bounded synthetic sandbox starts the API, correct Rhythm fork and local MCP, passes focused bootstrap/guard checks, and tears down without touching live services. Product behavior, web/Electron runner expansion, real Keychain, hardware fleet and installed artifacts remain NOT_TESTED and are validated only at their owning milestones.

### Phase 1 — Prevent wrong, lossy or unsafe behavior

| Unit | Ownership / work | Acceptance | Depends on |
|---|---|---|---|
| E10 | Electron package/sign/notarize scripts, engine resolver, release workflow | Native matching fork/Node/addons bundled with exact identity; no packaged PATH fallback. Missing/wrong fork blocks agent creation. Clean account without checkout/global OpenCode works. | E02 |
| E11 | `apps/electron/src/{agent-server,main,runtime-config}.mjs`, readiness/watchdog | Unknown occupied port untouched; incompatible owner rejected. Spawn/startup failure, exit-after-ready and bounded restart truthful; stop only owned processes. | E02 |
| E12 | Main/preload, signer/helper, production config, web main/auth/gateway roots | Server A bearer never reaches B; stale login loses; foreign frames/malformed input denied. Real non-exportable signing without argument secrets, isolated OS account. | E02; coordinate E11 |
| E13 | Automations page/controller/repository | Name-only/enable-only PATCH preserves configured disabled rule; omitted differs from explicit clear. Readback plus actual sandbox action, including Flutter/shared regression. | E02 |
| E14 | Tasks gateway/page, Planner | Fixed-clock local-date buckets; two distinct project step IDs complete/edit/move correctly in Planner/Projects after reload without changing sibling. | E02 |
| E15 | Facilities delete/cleanup and shared confirmation | Cancel zero writes; confirm actual room/reservation/series/preview scope. Stale preview re-confirms; failed/forbidden writes retain visible data. | E02, E50 |
| E16 | SessionRail, Composer, Profiles, store serialization | Bulk Cancel zero cancel requests; explicit Stop selected. Delayed attachment A→B isolation; child cannot send to parent; new permissions/delegates/account serialize and read back. | E02 |

Exit: safety contracts including negative cases and actual readback pass. Unimplemented misleading controls are disabled with reasons only as temporary containment, not completeness.

### Phase 2 — Complete Agents behavior and continuity

| Unit | Ownership / work | Acceptance | Depends on |
|---|---|---|---|
| E20 | **UI DTO/order only:** sessions gateway, SessionRail, narrow ordering module | D02–05 fields, scopes/archive/project/preview, stable ties and root/sibling ordering; consume E26 continuation/search without dropped matches or duplicate roots. No history controller/repository ownership here. | E16; integrate E26 |
| E21 | Store/session gateway reconciliation | Second-client create/rename/status/archive/remove converges for selected/unselected rows. Reconnect refreshes membership/detail without streamed-content loss; deleted selection clears, no fallback send target. | E20, E26 |
| E22 | Composer/Profiles/Agent Settings/tool UI/mutation adapters | Real catalogs/accounts; once-only versus durable defaults; actual engine identity/policy; default/duplicate/empty catalog, managed skills/playbooks, delegation/auto-approve, advanced task/account/cwd/branch/stash/dirty/worktree metadata. Scheduled configuration/execution/history, background runs/quality, webhooks and cookbook must be usable and durable, with linked real run/session outcomes and truthful errors. Agent Settings dangerous-tools, keybindings, runtime and MCP controls round-trip safely. | E16, E21 |
| E23 | Transcript/Inspector/workspace lifecycle | Archive/restore/fork at selected message/revert/unrevert/compact/init/copy/empty starters/start-fresh and worktree reset/remove use real operations from all entry points; engine outcome and reload prove success. Cleanup verifies registry, directory and branch, not only response status. | E21, E22 |
| E24 | Transcript/workspace decisions/children | Concurrent permissions/questions survive selection/reconnect; failed replies retry; rail attention; closed/error SDK recovery. Local children interactive, ephemeral views read-only; nested back/rail reset. Human approval preview/consequence and signed approve/reject retain policy gates. | E21, E12 |
| E25 | Rich sessions/sharing and knowledge/tool surfaces | Structured arguments/errors/envelopes, usage/cost/removal/error events and safe semantic markdown; files/search/attachments/export, tool shell/run/output/cancel, artifacts/todos/provenance/MCP Apps. Selected recipient review/share/revoke/denial works (Flutter sharing UNKNOWN). Memory CRUD/search/trust/verification, research project/pass/evidence/recovery/export/discussion, Gallery/Creative Media are explicit user jobs. **No interactive PTY in E25.** | E22–24, E12 |
| E26 | **Local SQLite session history/search API:** `apps/api_server/src/controllers/agent_sessions_controller.ts`, `apps/api_server/src/repositories/agent_sessions_repository.ts`; narrowly necessary route/types/tests | Compatible default response for existing clients; stable deterministic cursor and bounded roots, no duplicates/omissions; descendants and search beyond initial/descendant limits, including child-only matches. Preserve `agentExecutionEnabled`, authenticated role/access gates and local/SDK IDs. Not a direct dbClient-sqlite gate claim; no invented hosted Postgres history. | E02, E16; agree DTO with E20 |
| E27 | **ACTIVATED interactive PTY**, separate Terminal renderer/gateway/native capability work and existing API PTY routes/proxy only as required | Reachable Flutter chain confirmed; current Electron terminal fabricated/not live. All eight [PTY checks](../coverage/react-electron/user-job-matrix.md#interactive-pty--eight-mandatory-checks) pass independently through real HTTP/WS plus installed app; permission/origin/ownership and cleanup mandatory. | E02, E11–12, E16; coordinate E20–25 shared files |

Exit: create/configure/interrupt/review/recover/share/revisit complete work in Electron alone, including all matrix jobs above. A fixture action is never parity.

**Mandatory Phase2 installed Agents AJ checkpoint:** install the real candidate with real isolated API/fork, record SHA/artifact/architecture and have AJ perform rail/history/search, identity/configuration, live turn/attachment/tool, permission/question/child recovery, scheduled/background and knowledge jobs, selected sharing and interactive PTY. AJ records **continue**, **bounded repair** (named defect/scope, max two repair attempts, re-smoke), or **pause**. Only explicit AJ authorization after this checkpoint permits **Phase3–4 coding**; parallel execution approval alone does not bypass it. No screenshot, browser fixture or harness-only shell substitutes for the installed Agents experience.

### Phase 3 — Complete staff operational workflows

| Unit | Ownership / work | Acceptance | Depends on |
|---|---|---|---|
| E30 | Member gateway, Tasks/Rhythms/Projects/Planner/Dashboard forms | Actual authorized members; retain assignees, create collaborators, owner exclusion and forbidden cases. Add/remove/readback with non-fixture users; no cross-workspace leak. | AJ Phase2 authorization, E12, E14 |
| E31 | Facilities page/gateway/forms | Rooms/reservations, multi-room groups, weekly/monthly/custom series and individual occurrences; date ranges/buildings/conflicts/availability/role checks. Cancel/partial conflict leaves unrelated reservations intact. | E15, E30 |
| E32 | Planner/Dashboard | Bulk completion and within-day ordering persist; local start/end/DST and undated drag. Goal progress/health readout and project-step editing; no goals-only/messages-only false empty. Goal management UNKNOWN, resolve mount before claiming parity. Operational secretary/follow-up quick actions reach actual intended work with visible outcomes. | E14, E30 |
| E33 | Live Messages, notification/message state, shell links; Email surfaces | Second-user reply appears without reselect; late replies/route changes cannot mix threads. Real unread/read-all retry and account reset; exact target/fallback. Email signals and assistant operate on authorized connected account with real results, not receipts. | E12, E30 |
| E34 | Integration imports, LiveArtifactsShell | Monthly/annual and separate dates preview; second project-step failure/retry creates one template/each step once. Tabs persist/retry errors; share/preference failures visible; first import respects selected non-default workspace. | E30, E50 |
| E35 | Rhythms/Projects/Automations | Monthly/annual/sequential recurrence, offsets/milestones, actual assignees/collaborators/integration accounts and typed triggers/actions. Disabled survives unrelated edit; preview matches actual action. | E13, E30 |

Exit: actual two-user staff journeys, reload persistence and conflicts/errors pass. Fixture Facilities/rosters do not count.

### Phase 4 — Administration, platform integration and migration

| Unit | Ownership / work | Acceptance | Depends on |
|---|---|---|---|
| E40 | General Settings, App/Shell/settings APIs and remaining administration | Admin/member/facilities-manager permissions, membership/join codes, email preferences, provider credentials/accounts/defaults durable; denied changes visibly recover. General semantic-memory/vault settings, auto-promotion and Review Queue apply/history/undo plus tool install safety explicitly covered. Agent-specific controls stay E22; no duplicate owner. | AJ Phase2 authorization, E30, E22 |
| E41 | Mobile, Integrations, Settings entry | Navigate to pairing, real QR/test phone pairs once, expiry/consumed/revoke. OAuth returns without manual reload; provider accounts/preferences/calendar selection and Gmail/PCO sync in test accounts; retain ProPresenter integration job. | E40, E12 |
| E42 | Native session credentials, auth/package metadata/activation | Login reload/relaunch, expiry/logout/account/server cleanup. Cold/warm/background deep link or notification opens exact target once after auth; no credential replay or unsaved-work loss. | E12, E33, E40 |
| E43 | Migration wizard, separate native migration/runtime modules | Full migration/rollback contract on populated disposable stores: interruption/retry, ownership conflict, absent files, reauth, disabled schedules/review and recovery export. No shared writable Flutter store. | E10–12, E20–27, E40 |
| E44 | Release/package/sign scripts, native version/update UI | **Apple Silicon and Intel** native matching bundles; download/signature/notarization validation. Running/available version visible, explicit installer handoff; upgrade/rollback retain data. | E10, E42–43 |

Exit: fresh and migrated users configure/administer/pair/run without Flutter services. Flutter app/source/backups retained.

### Phase 5 — Usability, accessibility and performance

| Unit | Ownership / work | Acceptance | Depends on |
|---|---|---|---|
| E50 | FocusDialog/Shell/styles/feedback | Native dialog where appropriate; menu→dialog→Escape stable focus, background inert, hidden/disabled excluded, selected-control focus, repeat legible reduced-motion toasts. Skip focuses current main without navigation. | E02; early for E15/E34 |
| E51 | Composer/Transcript/announcements/markdown | IME Enter no send; autocomplete active choice/scroll/dismiss/error vs empty. Concise completed-output/decision announcements, no token chatter. Safe semantic markdown in Agents and Messages. | E23–25, E50 |
| E52 | Rail/workspace/Inspector/styles/history | Narrow panels coherent keyboard/modal behavior, unobscured popovers, ARIA dimensions match layout. Pinned bottom follows; scrolled reading/older prepend retains anchor. Comfortable/compact preferences. | E20, E25–27, E50 |
| E53 | Domain forms and bounded a11y qualification | 200% zoom, 320 CSS px reflow where applicable, both themes, forced colors/reduced motion, actual VoiceOver, labels/native semantics; no unresolved critical-job AA failure. | E30–42, E50–52 |
| E54 | Existing browser/native performance harnesses | Fixed synthetic 100 roots+children, 1,000-message transcript, streaming, 10 artifact tabs. Machine/build p50/p95; p95 selection/filter/input <200 ms, no unbounded growth in 20 open/close cycles or lost input. Locally hydrated shell <=5 s warm/<=10 s cold on supported reference machines, separate network/provider waits. Profile before new dependencies/virtualization. | E10–11, E21, E52 |

Exit: actual-app keyboard/assistive jobs and measured responsiveness pass. Accessibility is not deferred until this phase.

### Phase 6 — Integrated qualification and staged retirement

| Unit | Ownership / work | Acceptance | Depends on |
|---|---|---|---|
| E60 | Current integrated evidence/CI/package suites | All mandatory units, including E26/E27, on same candidate SHA and signed hash; full affected web/API/MCP/native and real behavior suites, latest shipped Flutter comparison. No missing tests, mocked-runtime relabel or unresolved safety/high gap. | E00–54 including E26/E27 |
| E61 | Clean platform matrix | Mandatory Apple Silicon and Intel accounts/VMs, no checkout/global Node/OpenCode. Install/login/exact local engine/create/respond/cancel/resume/quit/relaunch/deep link/notification/offline/online/sleep/wake/API+engine crash/update/rollback. Observe cleanup, not receipt constants. | E60 |
| E62 | AJ acceptance and pilot | AJ named installed journeys, then **five working-day pilot** with admin, staff and heavy Agents use. Incidents logged, fallback retained. No unresolved critical/high, data loss, duplicate schedules or policy failures. Explicitly accept lower-priority deviations. | E61 |
| E63 | Cutover and separate retirement handoff | Evidence, accepted limits, support/update owner and rollback drill. Explicit AJ default-client approval; **30-calendar-day Flutter fallback after pilot/cutover**, rehearsed recovery; separate AJ retirement approval only after stable window. No automatic source/deployment/branch deletion. | E62 |

Timeline is gate-based: implementation and qualification duration is **additional**, then five working days of pilot plus 30 calendar days of fallback: approximately **5–6 weeks minimum after qualification** before separate retirement approval (holidays, defects or repairs extend it). No date estimate compresses those windows. Electron default and Flutter retirement are separately authorized operational actions.

## Complete named journey map

The [matrix](../coverage/react-electron/user-job-matrix.md) is the row-level acceptance inventory. These groups retain the manager's original journeys and explicitly integrate E01 omissions; no group label waives a named child job.

| Journey | Owners |
|---|---|
| Install / Welcome / import, migration receipt and rollback without Flutter | E10, E43, E61 |
| Agents rail/scopes/search/sort/old roots/descendants/external updates | E20–21, E26 |
| New/Profiles/Composer: catalogs/accounts/defaults/once-only overrides, permissions/skills/delegation, branches/worktrees | E16, E22 |
| Transcript lifecycle/decisions/recovery/child sessions; real file and worktree actions | E23–25 |
| Inspector structured tools/files/artifacts/MCP Apps/todos/provenance; selected sharing | E25 |
| Interactive PTY: real shell, I/O, resize, persistence, exit/retry, access and cleanup | E27 |
| Scheduled config/execution/history; background runs/quality; webhooks; playbooks/cookbook | E22 |
| Memory CRUD/search/trust; research projects/passes/recovery/export/discussion; Gallery/Creative Media | E25 |
| Tasks/Planner/Dashboard date buckets, steps, goals readout, calendar, secretary/follow-up quick actions | E14, E32 |
| Rhythms/Projects/Automations people/recurrence/triggers/actions | E13, E30, E35 |
| Facilities rooms/reservations/groups/series/conflicts/delete | E15, E31 |
| Messages/notifications real-time and target navigation; Email signals/assistant | E33 |
| Integrations/import and Dashboard artifact context/recovery | E34, E41 |
| Agent Settings dangerous-tools/keybindings/runtime/MCP; general semantic-memory/vault; Review Queue apply/history/undo, tool install safety, auto-promotion | E22, E40 |
| Workspace/settings/accounts/mobile/QR/provider sync | E40–41 |
| Account/server/login/logout/native activation/update/signed upgrade/rollback | E12, E42–44 |
| Every job keyboard/VoiceOver/IME/narrow windows and measurable performance | E50–54 |

## File ownership, dependencies and safe concurrency

- `apps/electron/src/main.mjs`, `preload.cjs`: E11/E12/E42 sequential; runtime/agent-server identity E11, migration module E43 separate. Signing helper E12 is one narrow non-exportable P-256 adapter, chosen after isolated compatibility probe.
- `apps/electron/scripts/`, `.github/workflows/electron_release.yml`: E10/E44 bundling/signing/architecture/provenance, serialized where overlapping.
- `apps/web/src/gateway/sessions.ts`, SessionRail and ordering adapter: E20 UI DTO/order. **E26** exclusively owns local history/search controller/repository contract changes; agree compatibility before integration. Existing clients retain default response.
- `apps/web/src/store.tsx`: state composition, fixtures explicit; Agents/auth/Messages/notification changes sequenced. `components/{SessionRail,AgentsWorkspace,Composer,Transcript,Inspector,Profiles,ToolWorkspace}.tsx` retain respective jobs without competing state machines. E27 terminal UI must coordinate Inspector/workspace mounts, not silently edit E25 files concurrently.
- `apps/api_server/src/{routes/pty_routes.ts,services/pty_proxy.ts}` and narrowly needed terminal bridge: E27 separate security/runtime contract; no renderer generic process bridge.
- `components/FocusDialog.tsx`, `Shell.tsx`, `styles.css`: E50 shared dialogs/nav/tokens; serialize mount edits. Pages/gateways for Tasks/Planner/Rhythms/Projects/Messages/Facilities/Automations/Integrations/Dashboard/Mobile: E30–41; new general Settings composition E40 reuses current APIs.
- Backend corrections only as required; preserve auth and operational Postgres/SQLite compatibility without expanding E26 to hosted history. `apps/web/tests/`, `apps/electron/test/`, API/MCP tests: behavioral unit owners after E02 harness foundation.
- This E00/E01 doc lane owns only execution plan, current-plan pointer, new user-job matrix, baseline contract and baseline run. E02 exclusively owns testing-guide, sandbox/test configs, Electron/web package files and its own contract/run. No edits to those, project-state or manager source.

Critical path: **E00–02 → E10–16 → E20–27 → installed Agents AJ checkpoint/authorization → E30–35/E40–44 → E60–63**. E26 may build in parallel with E20 after contract agreement and disjoint ownership; E27 has independent PTY acceptance but shared mounts serialize. E50 starts after E02; E51–54 accompany feature completion. E10/E13/E14/E50 may overlap with exact disjoint files; Facilities E15/E31 has one sequential owner. Integrate and validate after each slice merge; no shared-file parallel rewrites. This plan authorizes managed parallel execution, not peer dispatch by this doc lane.

## Validation execution contract

Future commands retained from manager plan, **not run or re-certified here**; E02 must reconcile current package scripts/configs and prove discovery before use:

- Web: `npm run typecheck`, `npm run build`, `npm test`, `npm run test:dist-smoke`, `npm run test:list`; explicit Playwright config and single worker for shared state. `test:live` is not blanket discovery proof.
- Electron: `npm run typecheck`, `npm test`, `npm run test:package`; isolated `npm run package:mac` / `npm run sign:mac` for release qualification. Smoke/package:live does not certify normal E61 startup.
- Root issue/PR gates: `ai-workflow checks --level issue` and `ai-workflow checks --level pr`, supplemented by native/web and affected API/MCP suites.
- Backend: env-gated real API/fork/MCP behavior (`RHYTHM_LIVE_E2E=1` where applicable), exact discovered files/commands/observed outcomes in unit run. No mocked system under test.
- Only `tools/dev/sandbox.sh up/status/down` for backend lifecycle, after E02 readiness, with approved synthetic fixture and disposable paths from testing-guide. Default isolated API 4098/engine 4097. No hand-started API, live-data copy, private credentials or normal Electron beside live Flutter. Real Keychain and normal packaged lifecycle require dedicated disposable OS accounts/VMs, not temporary HOME alone.
- Qualification requires test providers, signing access, a test phone and both architectures; missing resources block the gate. No production access/deployment implied.

Evidence tiers and current statuses are defined in the matrix. Existing historical inventory, declarations and intercepted tests cannot supply runtime success. Exact methods/routes/file names, even tests named “live,” never yield PASS without the required current execution and observable result. Manager will run diff/Prettier/docs verification after E02 readiness; this doc lane runs **no app, test, build, server, normal Electron or private-data commands**.

## Risk review and stop conditions

Do not assume historical packages bundle the current fork, a health response proves ownership, or copying a DB preserves engine state/credentials. Disprove safely with isolated clean-account launch and populated migration/rollback rehearsal. Consult current Apple/Electron primary signing/storage documentation during E12/E43 compatibility work.

Refresh GitNexus for code work; upstream/API impact before edits. HIGH/CRITICAL stops for manager review; zero callers/processes is not safety proof. Before later authorized commits run detect_changes. Stop for wrong-target writes, data/policy loss, cross-identity credentials/files, duplicate scheduling, ownership violation, absent evidence or failed rollback. Do not broaden a harness to conceal failure. Each nontrivial UI slice gets early AJ journey smoke; Phase2 checkpoint specifically gates Phase3–4. No commit/push/PR/merge/deployment/cleanup authority is inferred for this documentation integration.

## Coverage and completion

- SHELL-1–10 → E10–12, E42–44, E54, E60–61.
- AGENT-1–14 → E16, E20–27, E51–52; E26 history and E27 interactive PTY explicitly included.
- PARITY-1–14 → E13–15, E22/E25 knowledge/run jobs, E30–35, E40–41.
- UX-1–16 → E50–54, E33–34 and each domain owner.
- HIST-01–21 → E00–02, E43–44, E60–63; source/history/runtime tiers remain distinct.
- D01–22 → corresponding units and complete job matrix; new shipping changes reconcile before closure and every gate re-baselines latest release/artifact.

Success is complete verified user jobs on one installed candidate, not issue counts, route strings, screenshots or fixture greens. Remaining UNKNOWN mounts and missing qualification resources are recorded gaps, never omissions or invented routes. This document authorizes execution within its gates, makes no readiness claim, and does not retire Flutter.
