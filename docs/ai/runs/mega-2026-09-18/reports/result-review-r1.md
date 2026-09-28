> **Artifact status:** The sandbox rejected creation of `.orchestrator/.gitignore` and `.orchestrator/REVIEW-r1-electron-mobile.md` because filesystem writes are disabled. No files were changed. The requested report follows.

# Adversarial review — r1-electron-mobile

**Range:** `648f8d58..HEAD`  
**Verdict:** **NOT READY** — 6 MAJOR findings, 1 MINOR finding.

## Findings

### MAJOR 1 — #1510 migration erases a saved explicit opt-in

`migrateWorkingSoundPreferences` forces every unmarked stored snapshot to `workingSoundEnabled: false`, including a stored `true`; its comment admits explicit opt-in is unknowable (`apps/mobile/providers/opencode-provider-utils.ts:159-165`). Both hydration paths apply that transform (`apps/mobile/providers/use-opencode-persistence.ts:157-167`, `:257-261`).

The regression test explicitly requires legacy `true` to become `false` (`apps/mobile/tests/contract/issue-1510-working-sound.test.mjs:33-45`, `:49-115`). This contradicts the issue and AJ’s extra requirement that migration never discard an explicit choice.

**Smoke contradiction:** Upgrade or relaunch with working sound intentionally enabled; the setting silently returns off.

**Fix:** Preserve an existing stored boolean and use the new default only when the field is absent.

### MAJOR 2 — #1510 a replayed busy event can restart sound after failure or cancellation

Failure and cancellation add the session to `stoppedWorkingSoundSessions` and stop playback (`apps/mobile/providers/opencode-provider.tsx:483-490`, `:3167-3175`, `:3669-3672`). Any later non-idle `session.status` removes that stop marker (`:3644-3650`), after which the effect starts playback again because the session is busy (`:3956-3976`).

The test sends `busy` after an error and abort but never asserts silence between that event and the next stop (`apps/mobile/tests/contract/issue-1510-working-sound.test.mjs:332-347`).

**Smoke contradiction:** Cancel or fail a turn; a delayed busy event makes the working chime resume until idle arrives.

**Fix:** Bind playback eligibility to a turn generation; busy events from a stopped generation must not re-enable sound.

### MAJOR 3 — #1510 tests cannot establish that either audible report is resolved

The issue requires separate source attribution on mobile and Electron plus audible checks on real clients. The mobile contract replaces Expo audio and storage with fakes (`apps/mobile/tests/contract/issue-1510-working-sound.test.mjs:17-28`, `:121-151`) and mounts extracted provider statements rather than the app (`:224-274`).

Electron only retains pending approval IDs to prevent repeated native notifications (`apps/electron/src/main.mjs:171-200`). No scoped test reproduces Electron’s sound or establishes notifications as its source. This is the exact limitation identified in the issue: mocked audio calls do not establish that the audible problem is resolved (`docs/ai/runs/mega-2026-09-18/issues/1510.md:42-51`).

**Smoke contradiction:** A physical iPhone or Electron text turn still rings while the automated suite is green.

**Fix:** Record separate source attribution and run the required audible matrix on a physical iPhone and packaged Electron app.

### MAJOR 4 — #1373 relay adoption swallows authentication failures

For a legacy pairing without `relayUrl`, `adoptConfiguredRelay` catches every relay error and returns `null` (`apps/mobile/lib/pairing/paired-host-store.ts:593-620`). This includes 401 and 403 responses.

`refresh` then probes the stored Tailscale URL (`:917-933`). If that URL is unreachable off-LAN, the outer 401 handler that clears a revoked credential (`:971-983`) never sees the relay rejection. The fallback test covers only a network error (`apps/mobile/tests/paired-host.test.mjs:323-339`).

**Smoke contradiction:** Revoke a legacy paired device, disable Tailscale, and relaunch. Mobile reports a reachability failure and retains the credential instead of showing revoked.

**Fix:** Fall back only for relay reachability failures; propagate 401/403 and reject mismatched host/account responses.

### MAJOR 5 — #1373 core transport, isolation, and observability criteria remain unproved

The scoped test proves relay base selection, health-probe grace, token use, and kill-switch preservation (`apps/mobile/tests/paired-host.test.mjs:301-417`, `:1146-1207`).

It does not:

- Drive SSE, PTY, or prompt traffic.
- Resume the same session after relay loss.
- Prove a duplicate session is never created.
- Deny a second user or project.
- Assert sanitized observability.

The scoped store handles discovery, grants, and health but contains no session-resume or observability contract (`apps/mobile/lib/pairing/paired-host-store.ts:627-817`, `:869-1013`). These are original acceptance requirements (`docs/ai/runs/mega-2026-09-18/issues/1373.md:14-21`).

**Smoke contradictions:** A relay drop opens a duplicate session; a cross-scope request succeeds; or failures lack sanitized operator/session/relay diagnostics.

**Fix:** Add an end-to-end relay transport test covering SSE/PTY/prompt resume, second-user/project denial, and sanitized observability.

### MAJOR 6 — #1520 lacks qualifying packaged-app visual and signature evidence

The assembly code validates all normal and Retina PNG slots, builds an ICNS, rewrites plist metadata, removes the Electron icon, and stages before signing (`apps/electron/scripts/package-mac.mjs:13-73`, `:162-167`, `:251-256`).

However:

- Native plist/artwork tests are skipped when the environment probe cannot assemble an iconset (`apps/electron/test/electron-icon.test.mjs:23-44`, `:86-121`).
- Release ordering is checked by scanning source text (`:151-160`).
- Nothing scoped inspects a freshly packaged signed `Rhythm.app`.
- Finder, Dock, Command-Tab, Get Info, normal, and Retina rendering remain unverified.

Those checks are required by `issues/1520.md:15-21` and `:30-31`.

**Smoke contradiction:** Unit checks pass while an installed artifact still displays a cached or generic icon, or signing fails.

**Fix:** Build the exact release artifact, inspect its plist and ICNS, verify its signature, install it, and record every required macOS visual check.

### MINOR 1 — #1496 says browsing is unavailable while Browse is enabled

The live Browse button enables when the bridge exists and fills `cwd` (`apps/web/src/components/SessionRail.tsx:521-527`). Its title and helper text nevertheless say native browsing is unavailable for every live gateway (`:521`, `:528`).

**Smoke contradiction:** A working Browse button is accompanied by text claiming that browsing is unavailable.

**Fix:** Show unavailable copy only when `selectDirectory` is absent.

## Expected-behavior checklist

### #1496 — Native directory picker

1. **SATISFIED:** Electron users can invoke the picker and fill `cwd` (`SessionRail.tsx:521-526`; `main.mjs:279-285`).
2. **SATISFIED:** Cancel returns `null` and leaves the value unchanged (`main.mjs:285`; `SessionRail.tsx:524-525`).
3. **SATISFIED:** Manual entry and fixture behavior remain (`SessionRail.tsx:521-528`).
4. **SATISFIED:** The bridge adds only `selectDirectory`, `hermes`, and `hermesView` beyond the prior surface. IPC validates the owner document/window before and after selection (`preload.cjs:88-100`; `main.mjs:110-123`, `:279-285`; `electron-shell.test.mjs:109-178`).

### #1520 — Packaged Rhythm icon

1. **SATISFIED:** Multi-resolution Rhythm artwork and plist metadata are assembled (`package-mac.mjs:13-73`).
2. **PARTIAL:** Code removes `electron.icns` and tests artwork identity, but the packaged primary icon was not inspected.
3. **MISSING:** No qualifying installed-app visual evidence exists.
4. **SATISFIED:** Icon staging occurs before signing (`package-mac.mjs:162-167`, `:251-256`).
5. **SATISFIED:** Missing or invalid inputs fail clearly (`package-mac.mjs:25-61`; `electron-icon.test.mjs:123-149`).
6. **SATISFIED:** Tests verify source hashes and extracted Retina pixels (`electron-icon.test.mjs:57-121`).

### #1510 — Unwanted processing bell

1. **MISSING:** Mobile and Electron sources were not separately reproduced and identified.
2. **PARTIAL:** Mobile defaults off and mocked stop paths exist; Electron silence remains unproved.
3. **MISSING:** Migration discards an unmarked stored `true`.
4. **PARTIAL:** Active disable and persistence pass mocked tests without physical audible evidence.
5. **PARTIAL:** Lifecycle exits stop playback, but a late busy event can re-enable it.
6. **PARTIAL:** Voice phases and notifications remain enabled in code, but real speech and alert behavior was not verified.

### #1373 — Cloudflare relay

1. **PARTIAL:** Relay-first health requests work without Tailscale; unchanged SSE/PTY/prompt transport is unproved.
2. **PARTIAL:** Tokens remain in secure storage, but legacy relay adoption swallows 401/403.
3. **MISSING:** No second-user/project denial proves tenant and project isolation.
4. **PARTIAL:** Transient health loss is covered; same-session resume and no-duplicate behavior are not.
5. **SATISFIED:** The kill switch selects the direct path, preserves saved pairing data and credentials, fails clearly for relay-only grants, and reconnects after re-enabling (`paired-host.test.mjs:1146-1207`).
6. **MISSING:** No sanitized observability record exists in scope.
7. **MISSING:** No threat-model artifact or second-user/project negative test exists in scope.

## Verification

- `node --experimental-vm-modules --test --test-name-pattern='directory-picker' test/electron-shell.test.mjs` — **PASS**, 4/4.
- `node --test tests/contract/issue-1510-working-sound.test.mjs` — **PASS**, 9/9, limited to fake native audio/storage and extracted provider logic.
- `node --test tests/paired-host.test.mjs` — **PASS**, including relay grace and kill-switch tests.
- `node --test test/electron-icon.test.mjs` — **NOT RUNNABLE IN SANDBOX**: `mkdtemp` failed with `EPERM` before tests.
- No servers or application processes were started. Pre-existing worktree changes and test artifacts were left untouched.

Codex session ID: 01a0b803-b781-7a81-9cf9-095adaf6e773
Resume in Codex: codex resume 01a0b803-b781-7a81-9cf9-095adaf6e773
