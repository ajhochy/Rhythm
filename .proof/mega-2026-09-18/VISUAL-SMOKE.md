# Rhythm mega PR native visual smoke

## Current run

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
