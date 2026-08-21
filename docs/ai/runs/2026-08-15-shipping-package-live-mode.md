---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [slice-7-c1]
status: blocked
tags: [run, Rhythm]
---

# Shipping package live mode

## Files

- `apps/electron/scripts/package-mac.mjs` now copies the caller environment, deletes all four
  `VITE_RHYTHM_*` gateway inputs, and only then assigns the non-secret packaged invariant
  `VITE_RHYTHM_GATEWAY_MODE=live`. The comment labels Vite gateway injection as TEST-ONLY for
  `npm run dev` and Playwright.
- `apps/electron/src/preload.cjs` keeps the existing frozen, versioned `window.rhythmShell` object,
  exposes only `RHYTHM_LIVE_API_URL` and `RHYTHM_LIVE_ENGINE_URL` under `gateway`, removes the host
  token field, and increments the bridge version to 4.
- `apps/electron/src/main.mjs` and the Electron bridge contracts now describe only the two runtime
  gateway bases.
- `apps/web/src/main.tsx` accepts a disposable `VITE_RHYTHM_LIVE_TOKEN` only on the TEST-ONLY
  Vite/Playwright path. A production token reaches `composeGateway` only from the successful Google
  sign-in response. Packaged live mode with either host base absent renders “Rhythm is not
  configured”, “You are signed out”, and “No fixture workspace has been loaded” without composing
  a fixture gateway.

No token or client secret is embedded. `GOOGLE_DESKTOP_CLIENT_ID` remains a public PKCE desktop
client identifier in the generated main-process config, and the packaged renderer receives its
session token only in memory from `rhythmShell.auth.signInWithGoogle()`.

## Checks

- PASS — `cd apps/electron && npm run typecheck`
- PASS (7/7) — `cd apps/electron && node --test test/google-oauth.test.mjs test/post-m1-phase-1-host-policy.test.mjs`
- PASS — sanitized live build:
  `cd apps/web && env -u VITE_RHYTHM_GATEWAY_MODE -u VITE_RHYTHM_API_BASE -u VITE_RHYTHM_ENGINE_BASE -u VITE_RHYTHM_LIVE_TOKEN VITE_RHYTHM_GATEWAY_MODE=live npm run build`
- PASS — `cd apps/web && npm run typecheck`
- PASS — the sanitized renderer contains neither poisoned URL nor the token sentinel, and
  `apps/electron/src/preload.cjs` contains no `RHYTHM_LIVE_TOKEN` channel.
- NOT RUN by instruction — Electron launch, packaged launch, `npm run package:mac`, Playwright,
  `verify-all.mjs`, and parity generation.

## Blocker

### Failure

The exact `slice-7-c1` forbidden-value predicate remains red after a correctly neutralized live
build because the poisoned mode value is the generic string `fixture`.

### Repro command

A text-only Node reproduction applied the test's `Buffer.includes(value)` predicate to
`apps/web/dist` after the sanitized live build.

### Expected

None of the four caller-supplied values occur in renderer bytes.

### Actual

- `fixture` occurs in both generated JS and CSS.
- `https://compiled-api.invalid`, `https://compiled-engine.invalid`, and
  `non-credential-build-sentinel` are absent.

### Likely cause

The renderer legitimately contains fixture-mode copy, storage keys, data-testid values, CSS class
names, and deterministic prototype data even when Vite compiles live mode. Therefore the test's
generic poisoned value collides with source content independently of caller environment.
`slice-7-c2` additionally requires the packaged bytes to match `apps/web/dist`, so copying cannot
hide the collision.

### Required fix

Human scope decision required. Either use a unique gateway-mode poison sentinel that cannot collide
with legitimate renderer content while retaining the three security-sensitive poison values, or
authorize a separate packaged renderer entry that excludes every fixture-owned surface. The latter
requires broad changes in `apps/web/src/pages/**`, `apps/web/src/gateway/**`, and shared fixture UI,
which this unit is explicitly forbidden to touch. The assertion was not changed or weakened.

### Required tests / evaluation

After that decision, the orchestrator should run the four commands listed in the task. In
particular, `slice-7-c1` must prove the invalid bases/token cannot enter the artifact and
`slice-7-c2` must continue to byte-match the same-step `apps/web/dist` build.

## Notes

- GitNexus file discovery worked, but symbol impact and final change detection were unavailable
  after its forced refresh encountered a missing `parsedfile-store` cache and then a LadybugDB WAL
  recovery condition. Equivalent call-site inspection limits the affected runtime path to the
  package script, preload bridge, renderer startup boundary, and their Electron contracts.
- Covered file touched: `apps/web/src/main.tsx` (manifest entry `src/main.tsx`). Its current SHA-256
  is `5150cbb2564e9b9c9d4f0ee85efa6ea3b88a4da3794b53b705c8d5df43d3c216`; the existing manifest
  entry remains `c1b7b8aec413b8322accacd97421bd662f2562c83046e39604eefc246e4de103` because this unit was
  explicitly forbidden to edit `apps/web/SHA256SUMS` or run the parity generator.
- `apps/web/SHA256SUMS` and `apps/web/PROVENANCE.md` were not edited.

BLOCKED — cannot make `slice-7-c1` green without a human decision between changing the colliding
poison input and expanding scope into forbidden fixture-owned renderer files.
