---
date: 2026-07-24
repo: Rhythm
branch: codex/mobile-1167-foundation
pr: null
issues: [1167]
status: complete
tags: [run, Rhythm]
---

# Issue #1167 — mobile foundation stabilization

## Files

- Fixed the mobile OpenCode contract resolver and its contract test for the
  Rhythm monorepo layout.
- Invalidated in-flight OAuth/session work across sign-out and provider
  unmount, including credential cleanup after a late exchange.
- Serialized credential mutation across every session-store instance so stale
  cleanup from an unmounted provider cannot erase a remounted provider's token.
- Added a delete-failure fallback that neutralizes a newly written session
  credential.
- Kept local-first sign-out available in offline and error account states.
- Added a root-level mobile CI workflow and an executable acceptance contract.

## Checks

- `CI=true EXPO_PUBLIC_E2E_MODE=1 npm run verify:foundation` — PASS.
  - lint and TypeScript — PASS.
  - contract, transport, account, OAuth, persistence, and fake-server checks —
    PASS.
  - Playwright fake-server web E2E — 15/15 PASS.
- `npm run test:rhythm-account` after same-store, cross-store sign-in, and
  remount-restore/hanging-request overlap regressions were added — 22/22 PASS.
- `npm run test:app-config` and `npm run test:ci:static` — PASS; the app-config
  contract is now included in both foundation and static CI.
- Ruby YAML parse of `.github/workflows/mobile_ci.yml` — PASS.
- `git diff --check` — PASS.
- GitNexus `detect-changes --scope all` — LOW risk, 17 changed symbols,
  0 affected processes.

## Notes

- The acceptance tests were observed failing before implementation for the
  monorepo path, stale OAuth guard, offline/error sign-out, and failed secure
  rollback cases.
- Independent review #1 found same-store stale cleanup and a masked app-config
  gate. Review #2 confirmed those fixes but reproduced the same race across a
  provider unmount/remount. Credential ownership is now module-global and the
  exact two-store sign-in reproduction is covered. Review #3 then reproduced
  mount-time `restore()` adopting the stale credential before cleanup; restore
  and refresh now share the same process-wide credential critical section and
  the exact remount-restore race is covered. Review #4 proved a never-resolving
  `/auth/me` could monopolize that lock after unmount; network validation now
  runs outside the short credential critical section and commits only after
  operation, generation, and token revalidation. Review #5 independently
  reproduced the adversarial cases and returned `SPEC PASS / QUALITY PASS`.
- Final independent reproductions observed:
  - remounted local sign-out completed in 0ms while an old `/auth/me` remained
    unresolved and removed the credential;
  - stale 401 cleanup preserved a newer signed-in token;
  - stale successful validation could not resurrect deleted metadata;
  - the optional `requestWithToken` fallback remained generation-safe;
  - no nested-lock, starvation, or network-held critical section remained.
