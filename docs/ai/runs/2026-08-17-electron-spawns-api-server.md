---
date: 2026-08-17
repo: Rhythm
branch: codex/react-electron-live-suite
pr: 1399
issues: []
status: pass
tags: [run, Rhythm]
---

## Files

- `apps/electron/src/agent-server.mjs` (new) — Node discovery, api_server entry resolution, env
  building, orphan reclaim, health polling, spawn/graceful-shutdown lifecycle.
- `apps/electron/src/human-approval-main-signer.mjs` (new) — main-process P-256 signer, Keychain-
  backed, called before every spawn to inject `HUMAN_APPROVAL_PUBLIC_KEY`/`_CAPABILITY_SHA256`.
- `apps/electron/src/main.mjs`, `preload.cjs` — wire spawn/shutdown lifecycle and two new narrow
  IPC surfaces (`agentServer`, `humanApproval`).
- `apps/electron/scripts/package-mac.mjs` — copy the two new source files into the packaged app.
- `apps/electron/test/{agent-server,human-approval-main-signer}.test.mjs` (new, 9 tests).
- `apps/electron/test/{electron-shell,electron-unsigned-package}.test.mjs` — updated exact bridge-
  key assertions for the two new preload keys.
- `apps/web/src/security/humanApprovalSigner.ts` — prefers the Electron IPC bridge when present,
  falls back to the existing Web Crypto implementation otherwise.

## Checks

- `apps/electron`: `npm run typecheck` clean; `npm test` 30/32 (2 pre-existing, unrelated native-
  notification gaps — confirmed via `git stash` that both already failed before this work).
- `apps/web`: `npm run typecheck` clean; phase-7 fixture 13/13 (c4d unaffected, confirmed the Web
  Crypto fallback path still exercises correctly with no `window.rhythmShell` present).
- Real (non-smoke, non-packaged) launch test against the live `tools/dev/sandbox.sh` instance:
  correctly detected the sandbox's own api_server on :4098, recognized the `--rhythm-sandbox=`
  marker, refused to kill it, and reused it as already-healthy — proving both the safety guard and
  the idempotency-reuse path work against a real process, not just mocks.
- Real cryptographic round-trip test: `signDecision()`'s output verifies against
  `capabilityMaterial()`'s reported public key using a from-scratch reconstruction of the server's
  own `human_approval_security.ts` verification logic (not an import — cross-package), and a
  signature over a tampered decision correctly fails to verify.

## Notes

AJ: "build the api_server spawning and injecting for the electron app. Mirror exactly the flutter
process as much as possible, bc we know that works."

Researched `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` +
`agent_server_controller.dart` in full via a dedicated research pass before writing any code (Node
discovery via login shell, dev/bundled entry resolution, the complete env var list, 40x200ms health
polling, the `--rhythm-sandbox=` orphan-kill safety marker, SIGTERM→2s→SIGKILL shutdown, and the
exact failure-reason → user-facing-message mapping). Ported field-for-field with two deliberate,
documented deviations, both to avoid touching the real production Flutter app's live state:

- **Ports 4098/4097, not Flutter's 4001/4096.** `apps/web/src/gateway/index.ts`'s
  `validateLiveBase` hardcodes exactly 4098/4097 for this renderer's entire live-mode gateway — that
  constraint predates this work (built across all 11 parity phases tonight) and isn't something to
  work around; Flutter's own ports would make this renderer refuse to treat its own spawned server
  as live at all.
- **A dedicated `Rhythm-electron` Application Support directory for `DB_PATH`,** not Flutter's
  `~/Library/Application Support/Rhythm/rhythm.db`. Two independently-spawned processes writing the
  same live SQLite file is a real corruption risk to the user's actual production data — not
  hypothetical, given tonight already had two unrelated data-loss incidents from shared state.

Two real bugs caught by actually running the new code, not just reading it:

1. **Packaged launch crashed with `ERR_MODULE_NOT_FOUND`** — `package-mac.mjs`'s copy list is an
   explicit file-by-file list, and the two new source files weren't in it. AJ caught this live via a
   screenshot of the actual crash dialog before I'd finished my own test pass; fixed immediately.
2. **`security find-generic-password -w` silently hex-encodes its output** whenever the stored value
   contains embedded newlines (a PEM always does) — undocumented CLI behavior, only found because
   the new crypto round-trip test actually exercised the Keychain read path and hit
   `ERR_OSSL_UNSUPPORTED`. Fixed by base64-wrapping the PEM before storage (single line, no
   newlines, sidesteps the heuristic entirely) rather than trying to detect/un-hex-encode after the
   fact.

Also closed the loop this work's own predecessor (`post-m1-p7-c4d`'s initial fix) left open: the
renderer's Web Crypto signer now checks for `window.rhythmShell.humanApproval` first and only falls
back to its own self-generated key when that bridge is absent (plain browser / Playwright). Since
`agent-server.mjs` and `human-approval-main-signer.mjs` are the SAME process spawning api_server AND
answering the renderer's signing IPC calls, a signature produced inside real Electron now verifies
against the exact server that Electron itself just started — the Web Crypto path's "not yet
synchronized with a live server" gap is closed for the Electron case; only the standalone-browser
case (no Electron main process at all) still self-generates independently, which is structural, not
a bug.

## What's left

- `apps/electron` does not yet bundle its own copy of `api_server` into a packaged `.app`
  (`package-mac.mjs` copies only Electron's own sources + the built web bundle) — `findServerEntry`'s
  bundled-path branch is real code but can never resolve today; only the dev-mode branch (walking up
  to find `apps/api_server` in a monorepo checkout) is reachable. Filed as a follow-up issue.
- The two pre-existing native-notification test gaps (`post-m1-p7-c4e`, `post-m1-p7-c4f-policy`) —
  unrelated to this work, confirmed pre-existing via `git stash`, filed as a follow-up issue.
- Full CI dispatch of `.github/workflows/electron_release.yml` and a clean-machine Gatekeeper check
  (Phase 11) still not run.
