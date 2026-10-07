---
date: 2026-10-06
repo: rhythm
branch: n/a (isolated owned source copy, not a git checkout)
pr: none
issues: none
status: Checkpoint B source authored; unverified (no tests, typecheck, lint or hashes run by the author)
tags: [run, rhythm]
---

# Mobile Research: project/run workflow (Checkpoint B)

## Files
Production (four):
- `apps/mobile/providers/services/rhythm-tools-service.ts`: canonical DTO types and strict validators, eleven typed methods, run predicates, budget bounds, and the exact older-gateway classification.
- `apps/mobile/providers/rhythm-tools-provider.tsx`: provider-owned Research workspace (`research` member of the existing context).
- `apps/mobile/app/tools/[tool].tsx`: thin Research wiring.
- NEW `apps/mobile/components/tools/research-project-workspace.tsx`: React Native presentation.

Tests:
- `tests/issue-1173-tools-service.test.mjs` (extended)
- `tests/tools/route-integration.test.tsx` (extended; its mock now supplies an optional `research` member)
- NEW `tests/tools/research-project-provider.test.tsx`
- NEW `tests/tools/research-project-workspace.test.tsx`

This note.

## Service
- Eleven operations under `/mobile-gateway/tools/agent-research`, all through `pairedRequest` (Mac project header and abort signal):
  - `GET/POST /projects`
  - `GET/PATCH /projects/:projectId`
  - `GET/POST /projects/:projectId/runs`
  - `GET /projects/:projectId/runs/:runId`
  - `POST …/cancel`, `…/resume`, `…/finish`
  - `GET …/export?format=markdown`
- Each id is a separately encoded segment. An empty id is rejected locally with no request. The five legacy operations are unchanged, and project/run responses never touch the legacy cache projection.
- `parseResearchProject`, `parseResearchProjectRun`, list parsing and the strict `{markdown}` envelope throw a safe `ResearchContractError` on a bad shape. Valid canonical objects are returned intact.
- Older-gateway classification (`isResearchOperationUnavailable`), status 404 and code NOT_FOUND only:
  - the exact message `MobileToolOperation not found` is unavailable for any of the eleven operations
  - the exact message `ResearchJob not found` is unavailable only for `listResearchProjects`
  - everything else keeps its real error
- Success of a list never proves capability, and nothing probes or scans.
- Pure predicates match LiveResearchTool:
  - active states pending, running, resumable and working
  - Cancel is active-only and Resume is error-only
  - Finish needs not active, a done evidence stage, and either no done synthesis or `budgetExhausted === true`
  - View report needs the first done synthesis stage to carry a nonblank string report
  - budget bounds validate each field (zero passes is valid)

## Provider
- State: projects, selected project id, that project's runs, exact selected run id and detail, explicit missing selection, report, pending tokens, errors, offline and unavailable flags.
- Fences:
  - Each request captures `{service, cache scope, generation}` before its first await.
  - It rechecks after every await and immediately before every state write (`commit`).
  - Selection changes, scope changes and service replacement advance the generation.
  - A scope change resets all Research state, including pending flags and the in-memory cache. A service replacement under the same scope only bumps the generation and releases pending flags.
  - An old response clears only its own pending token and cannot write an error, row or selection into a newer context.
- First selection is deterministic (the first project and first run returned), and then the exact id is retained across refresh, reorder and navigation. A vanished project or run becomes an explicit missing selection and nothing else is substituted.
- Explicit actions:
  - `createProject` validates locally and sends the specified canonical input. It never starts a run and selects only its own server id while the intent is current.
  - `saveSettings` does a fresh canonical read of the exact project. It merges only dirty budget fields over that read (omitting a missing or malformed untouched value rather than defaulting it). It sends both model-policy sides explicitly, merging the untouched side from the same read. It sends the PATCH and then does a fenced canonical reread, falling back to the PATCH response if the reread fails.
  - `startRun` rereads the project, refuses archived projects, and sends `{triggerType:'manual'}`.
  - `runAction` rereads the exact run, re-evaluates its predicate, rechecks currency and only then dispatches. A rejected dispatch gets one reread of that exact identity under its original currency, with no retry or replacement, and the original error is rethrown.
  - `loadReport` requires a ready run and fetches the export before showing it.
  - Mutations require a connected current service and no pending action for the same target. Offline or unavailable state refuses them with no request.
- Active-run updates mirror the desktop's single pending 5000ms read:
  - They run only while the Research route is visible, the app is active, the connection is current, the workflow is available and the selected project has an active run.
  - One request at a time. The timer is cancelled by scope, selection, visibility, connection or unmount changes.
  - A terminal state stops it, and a failed poll just stops it until the next explicit refresh. There is no background scheduler, retry or disk persistence.
- The existing rejected-Retry reread, `perform`, `refresh` and the cache are untouched. Checkpoint A's two Sol regression tests and four owner cases are preserved.

## Presentation and screen
- `ResearchProjectWorkspace` renders compact project cards (name one line, question two lines, budget one line), a selected-project detail with the full question, goals, budget and model summaries, Start run and Edit settings, current and prior run rows, stage rows, usage, the budget-exhausted note, the Resume, Cancel and Finish buttons and View report, the report through the existing `ResearchMarkdown`, and unavailable, error, offline and missing-selection notices.
- Create and settings dialogs use the existing `ToolDialog`, `NativeSelect` and the models from `useOpencode().availableModels`. An existing model absent from the list stays visible as its exact unavailable selection. A blank field becomes NaN, never zero, so the provider rejects it with a clear message.
- Drafts are local component state keyed by scope (and by exact project for settings). A same-project refresh keeps unsaved edits, and a different project or scope discards them.
- The screen mounts the workspace above the retained legacy history and its New research action, reports route visibility with a plain mount/unmount effect, and its refresh action also refreshes the workspace.

## Correction (five reds reproduced by Sol; sources unrun by the author)
Sol's two regression files (`research-project-boundaries-sol.test.tsx`, `research-project-draft-currency-sol.test.tsx`) are unchanged.
1. **Connection currency.** A connection change (loss, auth loss or regain) now advances the generation, revokes every in-flight read and follow-up, and releases the in-flight poll flag. `requireWritable` is reproved immediately before each follow-up mutation (the run action, the start run POST and the settings PATCH), so a connection lost while a preflight read was pending rejects the mutation. Already dispatched backend actions are not cancelled and no scheduler was added; their responses are just not applied.
2. **Read-frame lifetime and focus.** The read frame (route visible, app active, connection current, same selected project, unchanged frame epoch) is tracked through refs that `setVisible` and the AppState listener update synchronously. A pending poll is discarded at completion (no state or cache write) if any of these changed; timer cleanup alone no longer counts as revocation. This is separate from the mutation checks above. The route now sets visibility through expo-router's `useFocusEffect`, so blur clears it while the native stack keeps the route mounted. A mount/unmount fallback remains only for hosts whose router mock omits `useFocusEffect` (two contract tests I cannot edit do).
3. **Missing selected run.** A poll (and `readProject`) that no longer contains the exact selected run keeps its id as an explicit missing selection, clears its detail and report, and never picks another run. Polling stops because no active canonical run remains.
4. **No silent budget default.** Before a budget PATCH all four resulting known limits are validated. A missing or malformed untouched limit fails visibly with zero PATCH; a deliberately supplied valid repair is accepted. Zero and non-default limits are preserved.
5. **Draft completion currency.** `submitSettings` and `submitCreate` capture scope, exact project and a draft nonce before awaiting. Only a completion whose intent is still current and whose draft is unchanged since the send may clear or close it. The nonce advances when a dialog is reopened and when the key or scope changes. A resolved void from a stale cancellation can no longer wipe a newer draft or close a newer dialog.

Test changes (existing assertions and cases retained):
- Workspace test: an explicit renderer-settle helper (`reset`) replaces synchronous mid-test `cleanup()`, and dialog-closed expectations now `waitFor` Paper's close animation.
- Route test: the router mock supplies real `useFocusEffect` semantics, plus one focus/blur/refocus/unmount case.
- Provider test: preflight connection loss for start and save, missing and malformed untouched budget limits with a deliberate repair, and AppState background revoking a pending poll frame.

Unknowns: nothing here was executed. The serial `setTimeout(0)` settle and the `waitFor` close assumptions depend on Paper's animation timing in the jest environment.

## Second correction (poll read ownership and fixtures; sources unrun by the author)
Sol's actual-provider poll-lifetime regression (`research-project-poll-lifetime-sol.test.tsx`, immutable) showed three simultaneous run-list GETs after pending poll, disconnect, reconnect and the next tick.
- **Provider.** Invalidating a read frame hides its result but cannot settle its transport I/O, so ownership is no longer released by invalidation.
  - The poll's in-flight marker is now an owned token per service. Only the owning completion releases it (success, failure, discard or unmount). The connection and service effects no longer reset it.
  - All run-list reads for a service (poll, reconnect/visible refresh and project selection) go through one `readRunsExclusive` step. It waits for the one outstanding read to settle, re-proves the caller's current intent (service, scope, generation, frame, selection) after each wait, and only then issues one replacement read. Revoked data is never reused, nothing is aborted, and there is no queue beyond waiting on that one promise. The lock is per service transport, so a replaced service is never blocked behind an old one.
  - A poll tick skipped behind an owned read sets a deferred flag. When the owner settles, one state kick re-evaluates the existing gates (visible, app active, connected, active run, selection) and schedules one bounded 5000ms read; terminal, hidden, inactive, disconnected or unmounted state schedules nothing.
- **Route.** The production fallback was removed: `[tool].tsx` calls expo-router's `useFocusEffect` directly. The two non-Research contract mocks that import this route without that hook (`tests/contract/issue-1387-gallery-loading.test.tsx`, `tests/contract/issue-1387-models-loading.test.tsx`) now supply a focused-hook setup; their assertions are unchanged.
- **Fixtures.** The workspace test awaits RNTL's own `cleanupAsync` between renders instead of a guessed timeout (all 17 cases and the strict eventual dialog-null conditions are kept). The route focus test drives focus through a real subscription so the mounted route re-renders, keeping the exact `[true,false,true,false]` assertion.

## Not done / limits
- **Nothing was run.** Preimages were verified by the lead, not by me.
- The two 390×844 actual-component captures are not produced.
- No backend, API, transport, fake or e2e change. The paired gateway's eleven-operation slice, its Mac-scope guard and its export JSON adapter are owned by the queued API work. Until that is composed the Research project workflow shows "not available on this Mac yet" on older gateways and nothing here claims paired usability.
- The user's original Retry 400 cause remains UNKNOWN.
- (Superseded by the correction section below: route visibility now follows focus and blur.)
- Impact: `RhythmToolsService` MEDIUM (15 impacted, 10 direct callers) and the provider and screen LOW per the reservation. The new symbols are not in the index, so I checked their callers manually (the new provider hook has one caller, `RhythmToolsProvider`; the new component has one, the tool screen).
