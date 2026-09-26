---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
status: local-candidate-tested
tags: [plan, Rhythm]
---

# Replace the dashboard with Hermes Desktop

## Outcome

Clicking Rhythm's Hermes tab opens the actual Hermes Desktop workspace: its sidebar, chat, history, model/profile controls, settings and plugins. Its existing sessions and drafts work. Rhythm remains the outer application, and its working Google login, API and OpenCode engine continue unchanged.

This is a desktop integration project across Rhythm and the Hermes fork. It is not a URL change. The user authorized implementation after this plan. Deployment, new account flows, a default-engine change and retirement of either standalone application remain outside this work.

## Intent and constraints

- **User goal:** use Hermes Desktop inside Rhythm's Hermes tab.
- **In scope:** reuse the actual Desktop renderer; expose its required native services through an explicit embedded-host interface; preserve desktop features, data and lifecycle; package and test the resulting local app.
- **Outside scope:** rebuilding the Desktop UI from scratch, redesigning either app, changing Google OAuth/accounts, replacing OpenCode, mobile/Flutter changes, production schema/deployment, or fixing unrelated pending-approval notices as part of this replacement.
- **Constraints:** preserve c92c7544 startup/login repairs; no second API on 4001; reuse only recognized compatible services; stop only owned processes; preserve Hermes profiles, keys, sessions and standalone installation. Test destructive/file/agent operations only on synthetic workspaces. No silent installer, data migration, credential rewrite or automatic chat submission.
- **Design tension:** genuine Desktop feature compatibility versus its current assumptions that it owns the entire Electron application. Resolve this with an explicit host adapter, not direct import of its standalone entrypoint.
- **Cheapest proof:** mount the real Desktop renderer with real backend connection, load one existing session read-only, show the model/profile controls, then switch away/back without losing an unsent draft. Extend that proof to one controlled synthetic streamed turn and cancellation before declaring chat functional.

## Clarification interview

No questions: the user explicitly requested no questions and has now corrected the desired app. The plan uses the actual installed Hermes Desktop experience as the reference. Uncertain technical behavior is assigned a proof gate below instead of being presented as a settled implementation.

## Verified current state

Checked on 2026-09-19. Rhythm planning baseline: 25c5f4b2; repair source: c92c7544. Hermes fork baseline: 9c8dcf4230cbf3d386c29b730c5f82deea9523b0. Installed Hermes source checkout: 68518c1f9bca11d9f5dbdf59ecf7e024cce057ba. Both Hermes checkouts contain unrelated local changes; do not sweep them into this work.

- Rhythm currently invokes `hermes dashboard` and loads its HTTP root: `apps/electron/src/hermes-server.mjs:189`, `apps/electron/src/hermes-view.mjs:222`. The original B3 issue contract explicitly required the dashboard (`docs/ai/runs/mega-2026-09-18/issues/1542.md`). That contract must be superseded because it does not express the corrected user intent.
- The view geometry, isolated WebContentsView, route ownership and draft-only intent concepts can be reused. Its dashboard-specific preload, token/bootstrap assumptions, URLs, theme injection and dashboard readiness tests cannot prove Desktop integration.
- Hermes Desktop source is `apps/desktop/` in the Hermes fork, with its own renderer, preload, Electron main and Python backend. Its renderer explicitly fails without its desktop bridge (`src/app/gateway/hooks/use-gateway-boot.ts:135`).
- The installed Desktop preload exposes `window.hermesDesktop`, including connection discovery, native windows and backend operations (`electron/preload.ts:14`). Standalone `electron/main.ts` owns window creation and application startup (`createWindow`, `app.whenReady`). No supported embedded-host entrypoint was found in this investigation. The fork Desktop instructions also identify Desktop as the native chat surface (`apps/desktop/AGENTS.md:12-24`). The inspected preload has 193 invoke/send/subscription call sites; this is an inventory size, not 193 independent features.
- Hermes Desktop's canonical backend command is `hermes serve --host 127.0.0.1 --port 0`. Its source says the legacy `dashboard --no-open` fallback produces the same headless gateway (`electron/backend-command.ts:3-21`). Therefore changing the CLI command alone does not fix the wrong UI.
- Rhythm's installed dependency is Electron 33.4.11; Hermes Desktop declares Electron 40.10.2 and includes native node-pty. Compatibility and native-module ABI must be proven before choosing the shared version.

## Proposed architecture

```text
Rhythm Electron application
  Rhythm workspace and existing API/OpenCode lifecycle
  Hermes tab -> isolated WebContentsView
                  actual packaged Hermes Desktop renderer
                  scoped Desktop preload/host adapter
                    | native operations (files, dialogs, PTY, plugins)
                    | backend connections and event subscriptions
                    v
                  compatible Hermes headless backend
```

Keep the Desktop renderer and reusable native service code maintained in the Hermes fork. Add a versioned embeddable build/host entrypoint there. Rhythm consumes a manifest-pinned artifact built from an immutable fork commit, rather than copying from the mutable local installation. The standalone Hermes Desktop entrypoint must keep working against the same shared services.

Rhythm owns the outer window, menu, single-instance lock, application quit, signing and updates. The embedded host must not run Hermes's standalone app initialization or automatic credential migrations. Provide explicit adapters for native dialogs, media permissions, downloads, file access, terminal sessions, child windows and renderer events. Route privileged calls by owning webContents and document, not by a global channel name alone. Do not expose generic IPC dispatch to either renderer. Audit `BrowserWindow.fromWebContents` assumptions for embedded views. Keep credential storage identities stable: do not decrypt/rewrite Hermes secrets into Rhythm userData or run standalone startup credential migrations merely by opening the tab.

Pure backend coordination may live in a utility process if the proof demonstrates a benefit; Electron-only window APIs stay in Rhythm main. This is an implementation option, not a prerequisite. Do not attempt to move the window of an already-running second Electron application into the tab.

## Ordered implementation slices

| Order | Slice | Deliverable and likely files | Acceptance / evaluation | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Correct contract and inventory | Replace dashboard acceptance in new contract; Desktop feature-to-bridge inventory. Rhythm `docs/ai/contracts/`, Hermes `apps/desktop/src`, `electron/preload.ts`, `electron/main.ts`. | Every visible Desktop feature maps to a real host service, explicit window adaptation, or unresolved item. Capture standalone reference screenshots and source versions. Tests must fail if dashboard HTML is loaded. | None |
| 2 | Prove the actual Desktop in Rhythm | Fork adds proposed `electron/embedded-host.ts` and embedded build entry; Rhythm uses it from `hermes-view.mjs` behind a development gate. | In a real native window: actual Desktop shell, real profile/model list, existing session read, unsent draft survives tab change. No missing bridge errors, duplicate app/window or sign-in. Determine Electron 33 support versus explicitly scoped migration to 40. | 1 |
| 3 | Extract native host services | Fork refactors reusable handlers out of standalone `main.ts`; shared standalone/embedded adapters; preload contract and feature manifest. | Chat streams in synthetic workspace, stop works, restart/resume preserves history; file picker, attachments, terminal, settings, skills and plugins perform observable operations. Main and sibling frames cannot call each other's privileged handlers; no no-op success stubs. Standalone Desktop regressions run too. | 2 |
| 4 | Backend and state lifecycle | Replace dashboard-specific `hermes-server.mjs` with Desktop backend connection/ownership adapter; use fork backend command/health/claim/profile utilities. | Recognize and reuse a compatible authenticated backend or start an owned one. Occupied foreign port untouched. Profile switches, unavailable backend and retry behave clearly. Tab hide keeps sessions alive; final quit stops only owned children. Existing standalone data and process survive coexistence tests. | 2, with 3 integration |
| 5 | Finish tab and context behavior | Rhythm `pages/hermes`, bridge DTOs, `hermes-view` and preload; fork embedded chrome and draft intent adapter. | Familiar Desktop layout fills tab; Rhythm navigation remains usable. Keyboard, focus, resize, light/dark and zoom work. The scoped native context interface opens a reviewable draft and sends nothing. Session navigation targets correct Hermes session. Window controls/popouts have explicit mappings; no hidden unsupported controls. | 3, 4 |
| 6 | Repeatable signed package | Fork embedded artifact manifest; Rhythm `package-mac.mjs`, signing script, version/ABI/resource tests. | Fresh build pins renderer+adapter+backend contract versions and license notices. No mutable checkout path, secrets or user data in bundle. Exact local signed app launches with clean PATH; corrupted/missing payload fails honestly. Provider/backend credentials remain in their existing owner. | 3–5 |
| 7 | Integrated qualification and PR update | Real native tests, failure cases, screenshots, source receipts, corrected PR #1544/#17 evidence. | Installed app meets all criteria below; original login/runtime fixes still pass; user can inspect the correct Desktop build locally before push/release claims. Remove dashboard-only integration after new path passes. | 6 |

These are proposed slices, not remotely created issues. Keep implementation in isolated worktrees derived from the existing mega branches, and integrate into their existing draft PRs after local verification. No merge to main or production deployment is included.

## Full Desktop compatibility inventory

The proof in slice 2 is not the completed replacement. Inventory and qualify:

- Chat, streaming, tool/approval interactions, stop, session history, search and resume.
- Profiles, connections, provider/model selection and existing credentials.
- Attachments, file tree/editor, native file pickers, workspace paths, git views and terminal/PTY.
- Desktop settings, themes, keyboard shortcuts, clipboard, downloads, notifications and media controls where the reference exposes them.
- Skills, plugins and plugin-owned workspace panels, including the existing Rhythm plugin direction without introducing a recursive nested Rhythm/Hermes view.
- Secondary windows, browser popouts, quick entry, overlays and updater controls: map app-level actions to Rhythm ownership; preserve supported Desktop workflows. Any behavior that cannot be preserved stays an explicit acceptance gap, not a silently disabled control.

## Acceptance gates that prevent another wrong-app result

1. **Identity:** selecting Hermes loads the pinned Desktop renderer and its native bridge. Screenshot and runtime resource receipt match the standalone reference. Merely showing a Hermes heading or HTTP health 200 fails this criterion; loading the browser dashboard fails it.
2. **Real use:** selecting an existing session shows its real transcript. On a disposable test workspace, submitting one authorized test prompt streams output; Stop cancels it; reopening shows the saved transcript. Provider requests are confined to that explicit test; no production actions.
3. **State:** type an unsent draft, switch tabs and return, reload, then quit/relaunch. The reference Desktop's draft persistence behavior must be preserved, with no automatic send and no logged-out Rhythm session.
4. **Isolation:** hostile/sibling frames, stale renderer generations, unsupported methods and malformed payloads produce zero privileged operations. Plugin content does not inherit trusted renderer privileges. Rhythm login/approval material is never copied into Hermes renderer state or its logs.
5. **Lifecycle:** compatible running backend is reused without ownership; absent backend starts once; timeout/exit produces a clear Retry state. Tab switching does not cancel a running turn. Quitting leaves borrowed and standalone processes alive and leaves no owned orphan listener.
6. **Packaging:** installed signed bundle works outside both repos and developer PATH. Exact renderer/adapter/backend versions are recorded. Native modules are compiled for the selected Electron ABI. Signing and notarization are separate recorded checks; local signing alone is not release qualification.
7. **Regression:** Rhythm's Google sign-in/session restore, trusted reload, approval identity initialization, API/engine start-or-reuse and normal navigation retain their working behavior. The existing pending-approval/decision-load notices remain separately tracked and block an all-errors-cleared claim.

Use real Electron tests and visible native smoke for view/IPC/lifecycle criteria, not browser fixtures as their substitute. Run contract tests against deliberately wrong dashboard selection, removed sender validation and disabled draft retention to establish that they catch those regressions. Read-only startup/tab/draft checks must record zero hosted writes; synthetic chat/terminal tests get their own isolated workspace and trace.

## Packaging milestones and open technical decisions

- **Local proof:** package the actual Desktop renderer/host adapter and use the installed compatible Hermes backend through its supported discovery. Label this dependency explicitly; this is enough to evaluate the integration locally, not enough to claim a self-contained installer.
- **Distribution:** the earlier Hermes Python bundling gate is still NO-GO/unproven. Measure and qualify a pinned signable runtime separately (offline/no-checkout/no-system-Python startup, licenses, size, architecture). Do not silently revive dashboard fallback or omit this dependency from release claims.
- **Electron version:** prefer proven compatibility with the existing host if feasible. If Hermes needs Electron 40, scope and test the host upgrade explicitly across Rhythm OAuth, safeStorage, native helper, PTY, artifact views and signing. No casual dependency bump.
- **State coexistence:** determine the supported Desktop backend connection/claim handshake and profile stores before writing. Never attach based on a health endpoint alone. If sharing is unsupported, use a named isolated test profile with no automatic import/overwrite and document the production coexistence decision.
- **Full host surface:** extraction depth is not known until the bridge inventory and proof finish. Estimate remaining implementation after slice 2; a single-file patch estimate would be misleading.

## Prior art and decision basis

Official Electron docs support rendering host-created content in a [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view). [BaseWindow resource management](https://www.electronjs.org/docs/latest/api/base-window#resource-management) requires explicit child webContents cleanup. [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) and [sender validation](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages) inform the scoped preload adapter. [Utility processes](https://www.electronjs.org/docs/latest/api/utility-process) are an option for Node services, not a mechanism for embedding another native application window. The original adapter proposal was derived from those APIs plus the inspected Hermes source. Current implementation and native evidence are recorded in the linked run log.

During implementation the user removed the redundant outer Hermes header, dashboard-draft button and status strip. Desktop now fills that space; the scoped draft-intent bridge remains testable through the actual preload. No replacement chrome was added.

Parallel read-only research informed this plan; the user then authorized Terra implementation with parent review, testing and commits. See `../runs/2026-09-19-hermes-desktop-replacement.md` for execution evidence and outstanding release gates.
