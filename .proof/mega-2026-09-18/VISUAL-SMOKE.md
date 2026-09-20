# Rhythm mega PR native visual smoke

## Current September 19 desktop/phone checkpoint

The login/Keychain blockers in the historical sections below are superseded: the current Developer ID candidate95306 restores its existing login and signer, runs API/engine and actual Hermes Desktop, and restores the cloud relay. Current native Desktop read checks pass2/2; the phone receives a reply through its existing pairing. This candidate is not notarized. The nine original visual steps are still not all qualified. The final hosted cycle passes Automations and fails Facilities room visibility; only scoped collection marker cleanup is established. See [current receipt](../../docs/ai/runs/2026-09-19-connected-phone-relay.md).

## September 19 follow-up

The public desktop client ID, authorized process bearer and Flutter-owned local services are available. Fresh-profile startup is repaired, but the authenticated candidate blocked at protected Keychain persistence. The final client source additionally requires the new login-only API, which is not deployed. The nine authenticated workspace steps therefore remain **BLOCKED**. Finder/Get Info now also **PASS** on the exact-source signed/notarized ARM candidate installed separately as version0.18.65; Dock and Command-Tab remain unverified.

| Step | Expected | Observed | PASS/FAIL/BLOCKED | Screenshot |
|---|---|---|---|---|
| 01–08, 10 | Nine authenticated native workspace/comfort/folder/splitter/Hermes/zoom steps | Config and services restored; login reached provider, then secure persistence blocked. Safe final login now requires undeployed server capability. | BLOCKED (9) | Current sign-in outcome recorded in run log; protected dialog not captured |
| 09 | Rhythm icon in packaged Finder/Get Info | Mint waveform shown on signed70bcf2c9 candidate in user Applications, version0.18.65 | PASS | [Signed Finder](33-signed-installed-finder.png), [Signed Get Info](34-signed-installed-get-info.png) |
| Signed package | Current-source Developer ID and notarization qualification | ARM workflow passed; local codesign, Gatekeeper and stapled ticket passed before/after installation; ten artwork hashes and embedded engine source matched | PASS (ARM) | [Receipt](signed-arm64-verification.json) |
| Signed native login boundary | Old server cannot begin unsafe OAuth | Exact signed candidate displays required server-update error before opening Google | PASS (rejection only) | [Signed native](35-signed-native-safe-login.png) |
| Installed Dock/Command-Tab | Correct icon in both remaining macOS surfaces | Dock inspection timed out twice through supported control; no held-switcher capture API. No icon defect is inferred from unavailable observation. Normal/Retina resource assembly is verified, full surface matrix is not. | BLOCKED (2 surfaces) | [Launch/cleanup receipt](signed-candidate-launch.json) |
| Hermes mount | Real workspace mounts in rebuilt host | Isolated candidate mounted workspace and Connect Rhythm | PASS (candidate) | [Mounted](24-hermes-candidate-mounted.png), [Connect](25-hermes-connect-rhythm.png) |
| Hermes safe login | Old hosted API cannot begin unsafe OAuth | 503 before browser; final native message identifies required server update | PASS (rejection only) | [Final rejection](32-hermes-final-actionable-login.png) |
| Hermes running disposal | Removed plugin unloads without candidate restart | Agent plugins 1→0, sidebar and stale disk listing removed after Rescan; bundled Rhythm remains OFF | PASS (backend/route) | [Before](27-hermes-before-running-disposal.png), [Final after](31-hermes-final-running-disposal.png) |

The OAuth attempt exposed an integration overwrite bug; the existing Google/Gmail grants were restored and verified. See `docs/ai/runs/2026-09-19-mega-acceptance-followup.md` for incident, decisions, evidence and current gates. No password/token/key was entered in a UI. Installed Flutter/Hermes remain running.

## September 18 run (historical)

- Source: `mega/2026-09-18-mobile-electron-hermes`, integration worktree.
- Requested live build and launch executed. Hermes stdout reached `hermes: ready`; HTTP health returned 200.
- The native window is accessible in this run. The earlier computer-control permission denial is historical and is superseded by this attempt.
- Sign-in cannot start: `GOOGLE_DESKTOP_CLIENT_ID is not set; cannot start Google sign-in.`
- The executing process has no RHYTHM_LIVE_TOKEN; no listeners on requested API :4001 or engine :4096 at preflight.

| Step | Expected | Observed | PASS/FAIL/BLOCKED | Screenshot |
|---|---|---|---|---|
| 01 | Compact list/inspector on each management page and Agent Tool | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 02 | View options, archived chip, row spacing | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 03 | Compact Load subagents | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 04 | Native folder picker plus disposable project create/read/delete | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 05 | Grouped Profiles editor, sticky footer | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 06 | Matched light/dark Tasks and chat comfort with bounded width | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 07 | Three divider drags, reload persistence, Reset layout | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 08 | Hermes starting/ready, embedded themed dashboard, unsent draft | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 10 | Usable list/inspector and Agents rail at 200%; restore zoom | Workspace blocked at native Google sign-in before any of these controls are reachable. | BLOCKED | [Sign-in error](01-electron-google-client-missing.png) |
| 09 | Packaged Rhythm icon in Finder and Get Info | `npm run package:mac` passed after API test type repair. Native Finder and Get Info show the mint Rhythm waveform icon, Application (Apple silicon), version 0.1.0, in the assigned integration path. | PASS | [Finder](09-finder-packaged-rhythm.png), [Get Info](10-finder-get-info-icon.png) |

## Decisions

- Follow the latest request: current-run MEGA-SMOKE-2026-09-18 marker and integration/apps/electron/dist/Rhythm.app, superseding the older brief.
- Do not enter credentials, reuse another credential store, or bypass native sign-in.
- Keep startup health evidence separate from embedded dashboard/theme/draft behavior.
- Quit only the Electron smoke instance created here; its owned sidecar logged `hermes: stopped`.
- No product rows were created in the native window, and no appearance/zoom preference was changed.
- Use current screenshots rather than treating the previous control-permission failure as current evidence.

## Additional Hermes Desktop observation

- Authorized package installed/enabled; exactly one Rhythm sidebar entry appeared after two rescans.
- Initial route crash: the installed host did not expose a callable production JSX runtime export. The package now builds its JSX through host React `createElement`; the focused regression reproduced the failure before repair.
- Native route still did not render. A read-only renderer probe confirmed exactly one `/rhythm` registration, host resolver result `extension`, and zero `.rhythm-workspace-root` elements after rescans and a window reload. This is an installed-host mounting blocker, not proof of hosted reads or M3 authentication.
- Screenshot: [registered route without workspace](13-hermes-registered-route-unmounted.png). The initial failure is retained in [before](11-hermes-rhythm-route-chat.png).
- A second candidate replaced SDK state hooks, but its artificial throwing-hook test did not reproduce the verified installed SDK. That speculative change was removed before commit. The mounting probe was made with that diagnostic candidate; the final shipped repair is JSX-only.
- Window reload started the host's configured profile backends. The temporary Show all profiles -> Switch to default cycle restored the initial control state. No message was sent and no existing task/session was modified.
- Desktop Rhythm was toggled OFF before CLI uninstall. Hermes Desktop remains running under the user's no-quit rule.

- Final cleanup: CLI discovery and both install roots contain no Rhythm plugin; backups remain. Desktop Rescan removed the Desktop toggle and destination but retained a cached native-tools row. Complete running-backend disposal is unverified without a restart; none was performed. [Cleanup state](14-hermes-plugin-removed.png).

## Exact final fork package follow-up

The validated JSX-only artifact was reinstalled with its installed SHA matching `f99402ca3ee33664e1582d98659420ace509d874dc47f67b6c41c0f523cfd984`. Native Rescan/enable/click still showed the generic composer. A read-only registry probe confirmed `renderSucceeded:true` (React element creation only), `finalSdkCall:true`, `alternateHook:false`, `workspaceRoots:0`, and route `#/rhythm`. Thus the discarded hook candidate is no longer the only native evidence. The final package still cannot reach M3/read/ACP/draft controls. See [final route](15-hermes-final-jsx-route.png) and [final probe](16-hermes-final-jsx-probe.png). Desktop toggle was turned OFF before the final removal, with Hermes kept open.
