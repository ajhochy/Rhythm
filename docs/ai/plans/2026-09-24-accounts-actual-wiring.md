# #1569 actual Electron Accounts wiring supplement

The frozen brokered-credentials decision remains authoritative. This closes main/view/preload wiring only; all original 28 criteria, Accounts UI, native execution, shared agents and two-way delegation remain mandatory.

Use existing authentication lifecycle and safeStorage auth-session.bin. Enrich its envelope with the accepted auth helper's stable generation. Restore continues using existing main offline acceptance policy; refreshing trusted documents changes document epoch only. Login/logout/server change/untrusted navigation must synchronously revoke broker authority, await owned host disposal, then admit the next identity. Do not introduce a second session/credential store or forced network reauthentication.

Expose frozen `rhythmShell.aiAccounts` containing only `getStatus()` and `setGrant({action, provider, source})`, backed by `rhythm:ai-accounts:status` and `rhythm:ai-accounts:set-grant`. Main derives all identity/home/document values and invokes native confirmation against the current window. Invalid owner/frame/payload produces the helper's unavailable/rejected metadata DTO. Current document/auth must be rechecked after the dialog. No keys, fingerprints, OAuth contents or arbitrary paths cross these channels.

Create the helper only when authenticated canonical default home is available. Signed-out, missing-home and otherwise unavailable sharing must preserve ordinary uncredentialed Hermes attachment. Resolve OS home from native OS user information, not renderer/env overrides; inject fixture OS identity only in tests.

At real `createEmbeddedHermesHost` construction, pass trusted `backendEnvContext`, `backendEnv`, and synchronous `onOwnedBackendAttempt` only when available. Starting creates one main attempt; accepted maps to synchronous spawned receipt and throws if invalid; retired removes the attempt. Empty accepted receipts are legal. Bind receipts to their host/identity closure. Await all pending/active attempts on rotation. The view may accept a main-only callback supplying these options at host construction; never deserialize them from attach IPC. Native Hermes executes itself.

Suggested internal seam: `getBackendCredentialOptions?: () => { backendEnvContext, backendEnv, onOwnedBackendAttempt } | undefined` on registerHermesView. This name is advisory; the acceptance contract asserts the existing exported fork host option names, not the intermediate seam.

Ownership after contract review: main.mjs auth and Accounts composition/handlers; hermes-view.mjs trusted host options and disposal; preload.cjs closed bridge; any corresponding renderer declaration only. Accounts UI in AgentSettingsTool remains a separate owner. Prior helper/auth/broker source stays frozen until parent review requests changes. Register this test in Electron npm test during implementation, not now while prior package changes are being integrated.

## Evidence and boundaries

Command: `node --experimental-vm-modules --test --test-concurrency=1 apps/electron/test/hermes-accounts-wiring-contract.test.mjs` from candidate root.

RED: 8 tests, 1 passing ordinary signed-out attachment control, 7 failures at the absent actual preload Accounts bridge. The missing-home attachment itself succeeds before its Accounts assertion. Log: `/private/tmp/rhythm-s4-actual-wiring-red.log`.

The VM executes actual main, preload, production config and registerHermesView with actual account helpers when imported. Electron, OAuth interaction, supervisor and external fork host are synthetic. All files live under a disposable temp OS home/userData. This proves actual Electron composition to the exported host boundary; it does not prove the fork's child spawn or hermes:connection route. The native agent's real IPC/owned-spawn contract must pass separately; captured host options alone cannot close that gate. No real credentials, provider requests, API/engine servers or commits.

Parent review additions: I6/I7 now reopen actual main/view after new login, demand a fresh stable generation and reject old callbacks. I8 injects owned-host disposal failure and requires surfaced failure, unavailable sharing and no new host/server identity. Signed-out callback omission does not exempt the fork from unconditional inherited provider-environment sanitation; its companion contract covers that requirement.
