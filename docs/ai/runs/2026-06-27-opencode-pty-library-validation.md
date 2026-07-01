---
index: "[[Rhythm]]"
date: 2026-06-27
repo: rhythm
branch: fix/opencode-pty-library-validation
pr: 752
issues: [751]
status: merged
tags: [run, rhythm]
---

# Agents Terminal "connection failed" + session stuck "Starting" — diagnosis & fix

## Files changed
- `apps/desktop_flutter/macos/Runner/Release.entitlements` — add `com.apple.security.cs.disable-library-validation`
- `tools/release/sign_and_notarize_macos.sh` — sign the bundled opencode binary WITH `--entitlements "${PROCESSED_ENTITLEMENTS}"` (was signed with none)

## Checks run
- `plutil -lint` + strict `plistlib` parse — PASS (entitlement present, value `true`)
- `bash -n sign_and_notarize_macos.sh` — PASS
- Desktop CI (PR #752, run 28294948919) — SUCCESS
- End-to-end PTY validation — **deferred to release build** (hardened-runtime library validation isn't enforced in `flutter run`); v18.52 triggered (run 28295115213)

## Notes
**Two distinct bugs, co-occurring** (made one session look fully hung):

- **Bug A (fixed, PR #752 → merged `9a0618dde`):** opencode (a bun standalone) extracts an embedded native FFI dylib to a temp path and `dlopen()`s it at runtime for its PTY backend. The release signed the opencode binary with `--options runtime` (Hardened Runtime) but **no entitlements**, so macOS library validation rejected the differently-signed extracted dylib ("different Team IDs"). Surfaced as `Pty.create` → `TypeError: undefined is not an object (evaluating 'q.symbols')` → engine 500 → Flutter "Terminal connection failed". Reproduced directly against the running release engine (port 4096) and pulled the dlopen Team-ID error from `~/.local/share/opencode/log/`. Rhythm's Dart/TS wrappers are correct — they relay the engine error.
  - Caught a latent gotcha: a `--` (double hyphen) inside an XML comment in `.entitlements` breaks strict XML/codesign parsing even though `plutil -lint` passes.

- **Bug B (filed #751, deferred):** session status only leaves `starting` when `OpencodeStreamBridge` maps an opencode `session.status`/`session.idle` event to a local session via `opencodeSessionMap` (`opencode_stream_bridge.ts:278-286`, DB update `:570-573`). Delegated **child/sub-agent** sessions (e.g. a Secretary session invoking `@workflow-orchestrator`, run as an opencode child) aren't in the map, so the parent never transitions off the `starting` insert default. Live repro: parent `ses_…635063` vs child `ses_…6333ba`; log mentions 5 vs 88. Needs a state-machine fix (child→parent attribution via `parentID`, or flip parent to `working` on `session.prompt`); higher regression risk.

User-authorized merge-on-green + release this run.
