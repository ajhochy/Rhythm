---
date: 2026-09-18
repo: rhythm
branch: mega/ws-1510-bell
pr: null
issues: [1510]
status: partial
tags: [run, rhythm]
---

## Files

- `apps/electron/src/main.mjs`: retain native notification deduplication after dismissal/OS expiry while the approval remains pending.
- `apps/electron/test/e12a-auth-boundary.test.mjs`: execute the real main/preload modules with a fake Electron notification; reproduce dismissal followed by repeated approval snapshots.
- `apps/mobile/providers/opencode-provider-utils.ts` and `use-opencode-persistence.ts`: default processing audio off; migrate both initial hydration and host-switch hydration.
- `apps/mobile/lib/voice/working-sound.ts` and `providers/opencode-provider.tsx`: serialize player ownership and scope playback to the selected, connected, foreground session; stop on terminal events, cancellation, preference/lifecycle changes and unmount.
- `apps/mobile/tests/provider-utils.test.mjs` and `tests/contract/issue-1510-working-sound.test.mjs`: preference/persistence, native-player races and rendered sound-lifecycle contracts.

## Checks

Source base: `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`, branch `mega/ws-1510-bell`, Node `v22.23.0`. All changes are uncommitted. No servers, Electron, Playwright, or live runtime were launched.

Electron red reproduction, before the main-process change:

```sh
node --experimental-vm-modules --test --test-name-pattern='issue-1510' apps/electron/test/e12a-auth-boundary.test.mjs
```

Exit 1: `a dismissed pending ID must stay deduplicated across repeated snapshots`, `2 !== 1`; 0 pass / 1 fail. The fake OS closes the first notification, then the real IPC handler receives the same pending approval again. The original close handler deleted its dedupe entry, so it constructed and showed another native notification.

Electron after the change:

```sh
cd apps/electron && npm run typecheck && node --experimental-vm-modules --test test/e12a-auth-boundary.test.mjs test/post-m1-phase-7-native-notifications.test.mjs test/post-m1-phase-7-packaged-notifications.test.mjs
```

Exit 0: TypeScript clean, `# tests 13`, `# pass 13`, `# fail 0`. These are source-shell tests with fake Electron, despite the historical filename containing `packaged`; they do not qualify an installed/signed app.

Mobile commands/results are recorded in `REPORT.md`. Focused coverage includes the real persistence hook across remount and host change, the real audio module with a fake native player, and the sound-related provider statements mounted with React. The provider test extracts those statements and its event handler from the AST; it does not mount the entire application or exercise live SSE/network transport.

GitNexus upstream analysis reported LOW risk: start/unload each reach the provider and root layout (2 impacted); stop reaches conversation callbacks/provider/root (8); persistence reaches provider/root (2); provider reaches root (1); prompt and event callbacks each affect 3; abort reports 0 indexed callers; native notification sync affects its main file (1). No indexed execution processes were reported. This existing shared index is navigation evidence, not a fresh worktree index. Direct source inspection supplements it.

## Notes

### Electron: reproduced defect, unconfirmed cause of the report

At `apps/electron/src/main.mjs:169`, pending approvals are validated and reconciled by approval ID. Before this change, the native notification `close` listener removed the registry entry even though the approval was still pending. A subsequent identical snapshot could re-show it, allowing another OS notification sound. The test reproduces this using the real IPC handler and a fake notification; it cannot reproduce the macOS sound itself.

The corrected path retains the notification entry until the pending snapshot excludes it (`main.mjs:177`), the approval is cancelled/resolved (`main.mjs:161`), or authentication is invalidated (`main.mjs:95`). The initial notification options remain unchanged (`main.mjs:184`), preserving configured actionable approval alerts. Account isolation and current/stale notification click handling still pass.

**Attribution limit:** `apps/electron/src/preload.cjs:44` listens for `rhythm:approval-notifications`, but no sender for that event exists in the current `apps/web/src` tree. `apps/web/src/store.tsx:675` loads pending approvals on mount/gateway change; it does not poll or dispatch native approval snapshots. `Shell.tsx:131` renders the notification menu. Consequently this worker has demonstrated a latent repeat-notification defect, not that the September 17 candidate invoked it during AJ's turn.

### Exact source-search evidence

Commands run from the worktree root:

```sh
rg -n -i 'Audio\(|AudioContext|new Notification\(|\bsound\b|\bsilent\b|\bbeep\b|\bbell\b|bellStyle|<audio|xterm|\\[ax]07|\\u0007|fromCharCode\(7\)' apps/web/src apps/electron/src
rg -n $'\x07' apps/web/src apps/electron/src
rg -n 'Audio\(|AudioContext|<audio|bellStyle|bellSound|onBell|\\x07|\\u0007|fromCharCode\(7\)' apps/web/src apps/electron/src
rg -n 'rhythm:approval-notifications' apps/web/src
```

The broad search exits 0 and finds only `Shell.tsx:131` (bell icon/menu), `icons.tsx:13`, `store.tsx:97` (comment), xterm imports/comment/CSS (`Inspector.tsx:11,13,291`, `terminal.css:6,7`), and `main.mjs:184` (native notification; after the fix also its explanatory comment at 194). The other three searches exit 1 with no matches. In particular there is no renderer `Audio(...)`, `AudioContext`, `<audio>`, beep call, BEL literal/escape, or `onBell` listener found.

PTY output is passed through to xterm by `apps/web/src/components/Inspector.tsx:319`, so external PTY output could contain BEL even though no literal occurs in this source. The installed dependency is `@xterm/xterm` 6.0.0 (`apps/web/node_modules/@xterm/xterm/package.json:4`). Inspection with:

```sh
rg -n 'Audio|bellStyle|bellSound|onBell|playSound' apps/web/node_modules/@xterm/xterm/src -g '*.ts'
```

finds an `onBell` event relay (`src/browser/CoreBrowserTerminal.ts:163`), public event accessors, obsolete explanatory comments in `InputHandler.ts:696`, and audio-volume key names. It finds no playback implementation. The current terminal option typings have no `bellStyle` or `bellSound`. There is no source-supported reason to add an unsupported `bellStyle` property or strip PTY output.

`apps/web/src/store.tsx:268` implements `notify` by updating toast state, not by playing audio. No equivalent Electron processing-sound loop was found.

### Mobile behavior and migration

The original source loops a synthesized 1.8-second WAV; the soft variant combines 261.63, 329.63 and 392 Hz (`working-sound.ts:79`). It previously started for *any* busy session with a default-enabled preference. This is a plausible source-level mobile trigger, not a physical-device reproduction. Current mobile package metadata says 1.0.8; the build on AJ's device remains unknown.

Preferences persist the entire object, with no historical explicit-choice provenance. Under the worker brief's prescribed fallback, an unmarked stored `true` becomes `false` once; unmarked false/missing stays false. Both hydration paths persist `workingSoundDefaultMigrated: 1` with the off value through existing scoped write-back. Once marked, a user enabling sound keeps `true` after relaunch/host switching; disabling it remains off. An intentional legacy `true` cannot be distinguished and therefore also resets once. No other preference is changed. The marker is optional in the TypeScript shape so legacy snapshots/test fixtures remain valid, but fresh defaults and migrated snapshots include it.

Playback commands share one serial queue and one player handle. Stops/unloads invalidate pending starts synchronously; delayed loads never begin playing afterwards. Duplicate starts do not restart an already-playing handle; variant changes unload before replacement. Errors release the handle, and failed pause attempts fall back to unload. Terminal events/cancellation suppress stale busy polling until a new prompt or non-idle status event. The effect uses scalar busy state, so duplicate busy events do not churn playback. Intentional speech helpers and completion-notification code are unchanged.

### Remaining audible qualification

The reported Electron candidate was built from `4103f54c` on September 17 and used interactive mode against Flutter-owned API `:4001` and engine `:4096` (worker-brief context, not reverified this run). The current source checkout is a different revision. Alternative emitters remain Flutter's client/runtime, another connected client (including mobile), and macOS per-app notification sound settings. These are hypotheses, not findings.

On a physical iPhone and the actual Electron candidate, identify the emitting device/process independently and with both clients connected. Record build, foreground/background, voice mode, working-sound setting, repetition and correlation with streaming/tool events/approvals/reconnect/completion. Exercise long turns, mid-turn disable, cancellation, error/recovery, session switches, intentional voice/approval/completion alerts, and a second turn after relaunch. Do not restart or adopt Flutter's services for this qualification. Until then the audible issue and affected builds remain unconfirmed.
