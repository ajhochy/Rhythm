# fix(opencode): augment PATH so the SDK can find the opencode binary in GUI-spawned api_server

## Problem

On macOS release builds, agent OAuth fails with "Opencode engine not ready" or "bridge failed: SDK_not_ready". Root cause:

1. `@opencode-ai/sdk`'s `createOpencode()` spawns the `opencode` subprocess via `cross-spawn("opencode", args, { env: process.env })` ([@opencode-ai/sdk/dist/server.js:12](file:///Applications/Rhythm.app/Contents/Resources/api_server/node_modules/@opencode-ai/sdk/dist/server.js)).
2. The binary lives at `~/.opencode/bin/opencode` (installed by the user's prior opencode setup).
3. When Rhythm.app is launched from Finder/Dock, macOS strips the spawned api_server child's PATH to `/usr/bin:/bin:/usr/sbin:/sbin`. None of those contain `opencode`.
4. `cross-spawn` can't find the binary → opencode subprocess never starts → `OpencodeClientService.initialize()` throws → `isReady` stays false → every auth endpoint returns SDK_not_ready / "Opencode engine not ready".

The same class of bug already has a workaround for **Node** (login-shell PATH probe in `ApiServerService._findNode`). Opencode was never given the equivalent.

## Why it's invisible in dev

`flutter run -d macos` inherits the developer's terminal PATH (which includes `~/.opencode/bin`), so `cross-spawn` finds opencode. The bug only manifests in the packaged `.app` bundle.

## Scope

`apps/api_server/src/services/opencode_client_service.ts` — extend `process.env.PATH` before calling `createOpencode()`. Idempotent so repeated `initialize()` calls (e.g. in tests) don't accumulate duplicates.

## Acceptance criteria

- [ ] `OpencodeClientService.initialize()` prepends `~/.opencode/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` to `process.env.PATH` before invoking `createOpencode`.
- [ ] PATH augmentation is idempotent — multiple `initialize()` calls don't grow the PATH.
- [ ] Unit test in `opencode_client_service.test.ts` asserts the augmented PATH contains the expected dirs.
- [ ] `apps/api_server` `tsc --noEmit` clean.
- [ ] `apps/api_server` `vitest run` green (existing 499 + new test).
- [ ] No Flutter changes required.

## Manual verification (release-build)

After this lands and a new DMG is built:
1. Fresh install of Rhythm.app on a clean macOS account.
2. Launch from Dock/Finder (not terminal).
3. `curl http://localhost:4001/opencode/auth` → `{"providers":[...], "ready":true}` without manual symlinks or `.app` patches.

## Out of scope

- Login-shell PATH probe fallback (mirrors `_findNode`). Useful as belt-and-suspenders if a user installs opencode somewhere custom, but the three hard-coded paths cover ≥99% of users. File as a follow-up if a custom-install case surfaces.
- Auto-recovery from stale opencode subprocess on port 4096 (separate orphan-cleanup concern, in spirit of #614 but for the SDK's own child).
