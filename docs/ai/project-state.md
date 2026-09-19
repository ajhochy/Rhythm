# Rhythm — Project State

## Current focus

Exact-session external opening in the source Electron client, approved by AJ as
Rhythm's companion change for Bot Crossing. The renderer now consumes the existing
`rhythm://app/index.html#/agents?sessionId=<local-id>` contract and fetches the exact
conversation even when absent from the first list page. Flutter remains the
shipping client; this does not change the Electron replacement/release gates.

## Active branch / PR

- `codex/electron-session-opening`, isolated from the original dirty checkout,
  based on `2350a500fe87f4acdc429be4c181997f251ce4e3` (`origin/main`).
- Draft PR publication pending; no merge authorized.
- Evidence and exact commands: [run record](runs/2026-09-18-electron-session-opening.md).

## In progress

- Broad `ai-workflow checks --level pr` exited 1 in three unchanged packages.
  Focused renderer, native source-shell, and actual warm-profile opening checks
  succeeded; the draft is qualified only for this opening change.
- Existing Electron replacement, signed-package, architecture, and provider
  qualification remain separate. Prior release history is preserved in
  [the catch-up run](runs/2026-09-16-main-catchup-release.md).

## Risks / known issues

- Replacing generated assets underneath a running shell requires one renderer
  Reload. Existing security policy clears authentication on that navigation;
  normal Google sign-in is required once. Subsequent hash-only links reuse it.
- Built capability metadata describes the on-disk renderer, so handoff must also
  refresh an already loaded old document before reporting opening capability.
- Native sandbox uses a disposable synthetic identity and mock Keychain. It does
  not qualify signed packaging, real Keychain, production OAuth, or Flutter.
- No API, engine, main/preload, authentication, or session-lifecycle source changes.
  Live services and the existing main process were preserved during the handoff.

## Test status

- Issue static gate: 4 checks, exit 0. Electron unit suite: 73 tests, exit 0.
- Exact-session UI/parser suite: 13 tests, exit 0; two reproduced red regressions
  demonstrate wrong initial selection and stale reconciliation clearing selection.
- Real source Electron + rebuilt canonical sandbox: cold and same-profile
  second-instance exact selection, one window, zero opening mutations, unchanged
  service PIDs, and screenshots. Neutral renderer build and credential scan pass.
- Actual live warm-profile opening matched the requested session after Reload and
  normal Google sign-in; main/API/engine PIDs survived and service badges healthy.
- Full PR gate: 13 stages passed; API trigger-parity assertion, fork interrupted
  bash finalization, and mobile edited-title UI assertion failed. Root causes
  remain uninvestigated. [Follow-up](issues/2026-09-18-unrelated-pr-gate-failures.md).

## Next step

Open the scoped draft PR and preserve human review before merge. Resolve the
separate broad-gate failures before claiming a repository-wide green gate.
Signed/installable Electron qualification remains separate work.
