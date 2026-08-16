---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-2]
status: partial
tags: [run, rhythm-react-electron-live-suite]
---

# Post-M1 Phase 2 packaged profile security

## Files

- `apps/electron/src/main.mjs` — adds the smoke-only `--profile-security-smoke`
  observation channel and `profileSecurity` receipt section.
- `docs/ai/runs/2026-08-15-post-m1-phase-2-packaged-profile-security.md` — records
  this unit's static evidence and the orchestrator-owned packaged verification.

## Receipt observations

- `profileSecurity.operations` comes from Electron's
  `session.defaultSession.webRequest.onBeforeRequest` hook, registered before the smoke
  `BrowserWindow` is created or its initial renderer URL is loaded. The hook observes actual
  renderer HTTP(S) requests, records their real method and URL pathname, normalizes concrete
  `/agent-configs/<id>` paths to `/agent-configs/:id`, and deduplicates the observed set. The only
  excluded requests are the known background live-readiness probes (`GET /health`,
  `GET /global/health`) and the initial Agents workspace session-list hydration
  (`GET /agent-sessions?scope=chats`); every other HTTP(S) request in the observation window enters
  the operation set, so an unexpected config/auth/credential or arbitrary network request makes
  the exact allowlist assertion fail.
- The packaged renderer itself is driven through the Profiles controls: its initial live hydration
  performs the profile list, then the smoke clicks Create + Save, changes the rendered profile
  label + Save, confirms Delete, opens Advanced session creation, and starts a session with the
  rendered profile selector. The host waits for each matching observed request and corresponding
  DOM completion; a missing operation aborts the smoke instead of being synthesized.
- `POST /agent-sessions {profileId}` is emitted only when the real `onBeforeRequest` event's
  `uploadData` bytes parse as JSON and the parsed request body owns a `profileId` property. An
  absent, opaque, or malformed body remains `POST /agent-sessions` and therefore fails c4a.
- `profileSecurity.renderedText` is read from the actual `textContent` of the packaged Profiles
  failure element (`[data-testid="tool-state-failure"]`) after navigating to
  `#/profiles?state=failure`.
- `profileSecurity.diagnostics` is read from the actual `textContent` of the packaged renderer's
  visible Environment receipt (`[data-testid="environment-receipt"]`).
- The existing `bridge` receipt remains the preload observation used by c4c; this change does not
  add a preload capability.

The Endpoint Map scrape was removed completely. It was static developer-authored documentation and
could not prove which requests the renderer made; retaining it even as a fallback would allow an
unapproved call to produce the same green receipt. No `#/endpoint-map` navigation or endpoint-row
lookup remains in the smoke path.

The observer and profile-driving code are gated by `--profile-security-smoke`, and receipt execution
still requires `--smoke`; normal launches register no request observer, do not drive these controls,
and emit no `profileSecurity` section. The `userData` redirect remains before
`app.requestSingleInstanceLock()`.

## Checks

### Static syntax — PASS

```bash
node --check apps/electron/src/main.mjs
```

No output; exit 0.

### Non-GUI host-policy regression — PASS

```bash
cd apps/electron
node --test test/post-m1-phase-1-host-policy.test.mjs
```

This source/policy test does not launch Electron. The GUI-launching shell tests were deliberately
not run in this unit.

### Electron TypeScript check — PRE-EXISTING FAILURE

```bash
cd apps/electron
npm run typecheck
```

The check reports existing `checkJs` errors on unchanged lines 45, 48, 52, and 148 of
`src/main.mjs` (`mainWindow`, `argv`, and `pendingDeepLink`). No reported error maps to the added
profile-security observer or receipt-driving block. Two repair passes removed all newly introduced
typecheck findings; no unrelated type cleanup was attempted.

### Diff hygiene — PASS

```bash
git diff --check
```

Exit 0. GitNexus tools were not exposed in this session, so the required indexed impact and
`detect_changes()` calls could not be run. Read-only call-site inspection found this receipt is
consumed by `apps/web/tests/post-m1-phase-2-profile-security.redspec.ts`; the Electron directory is
currently untracked, which also prevents ordinary `git diff` from displaying its contents.

## Orchestrator verification required

These commands intentionally were not run in this unit because they package and launch Electron:

```bash
cd apps/electron
export VITE_RHYTHM_GATEWAY_MODE=live
export VITE_RHYTHM_API_BASE=http://127.0.0.1:4098
export VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097
export VITE_RHYTHM_LIVE_TOKEN=phase-2-route-token
npm run package:mac
node --test test/electron-unsigned-package.test.mjs

cd ../web
RHYTHM_PACKAGED_PROFILE_E2E=1 npx playwright test \
  --config tests/post-m1-phase-2-fixture-playwright.config.ts \
  tests/post-m1-phase-2-profile-security.redspec.ts
```

The run remains `partial` until the orchestrator observes the packaged receipt and all three c4
assertions pass.
