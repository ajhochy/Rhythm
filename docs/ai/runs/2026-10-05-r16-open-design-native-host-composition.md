---
date: 2026-10-05
repo: Rhythm
branch: codex/r16-dayflow-coordinator-delivery
pr: none
issues: [r16-open-design-native-host-composition]
status: unverified
tags: [run, rhythm, electron, open-design, dayflow, source-qualification]
---

# R16 OpenDesign native host composition

UTC source-qualification receipt: `2026-10-05T08:27:12Z`.

## Scope

- `apps/electron/src/main.mjs` registers the existing Hermes, OpenDesign,
  Dayflow, and Bot Crossing host objects in one closed adapter registry. The
  OpenDesign registration uses the existing `ownsDocument` predicate plus the
  current signed-in and unblocked account state. Identity reset calls
  `disposeCurrent()` and app quit calls `dispose()`; neither path starts,
  stops, signals, or configures OpenDesign.
- `apps/electron/src/preload.cjs` exposes a frozen, nonce-private
  `openDesignView` with only `getStatus`, `attach`, `setBounds`, and `detach`.
  The attachment nonce and epoch stay in preload; stale attach completions are
  discarded without a renderer-supplied nonce, URL, path, PID, or origin.
- `apps/electron/src/security-smoke-receipt.mjs` adds the exact frozen nested
  inventory and main smoke receipt metadata only. The smoke receipt does not
  call an OpenDesign status or native-view operation.
- `apps/electron/package.json` registers the four focused Agent Tools and
  OpenDesign tests. `scripts/package-mac.mjs` already copies all runtime
  `src/` modules, so no selective-copy-list change was needed.
- `apps/electron/test/dayflow-host-hooks.test.mjs` gained inert VM seams for
  the new imports and a composition regression that verifies all four adapter
  registrations, signed-in/top-frame gating, reset disposal, and quit disposal.
  `open-design-preload-hook.test.mjs` now executes the actual preload source
  in a VM; `security-smoke-receipt.test.mjs` rejects missing, additional,
  misordered, and unfrozen OpenDesign nested bridge metadata.

No accepted Dayflow helper, OpenDesign runtime/view/registry module, web UI,
backend/coordinator source, plugin directory, signing script, or packaged app
was edited.

## Impact review

- Bounded GitNexus attempt: this isolated delivery checkout is not indexed
  (`gitnexus status` returned `Repository not indexed.`). Reindexing was not
  permitted. The available `/Users/ajhochhalter/Documents/Rhythm` index predates
  this composition: it did not contain `registerOpenDesignView`; its stale
  result for main `ownsDocument` was LOW risk with two direct dependants, and
  `validateSecuritySmokeReceipt` was LOW risk with two direct dependants.
- Manual impact scope: main's existing trusted top-frame policy, the four
  explicit host adapter registrations, profile reset, quit teardown, the
  frozen preload surface, main's metadata-only smoke extraction, and receipt
  validation/test consumers. No renderer URL/path/PID/nonce authority was
  introduced.

## Source snapshot

The patch below is a narrow composition-only delta against the accepted
Dayflow/OpenDesign preimages, not against the frozen Git index. It passed a
reverse application check against the current postimages:

- `/private/tmp/r16-open-design-host-composition.patch`
- SHA-256: `2ee78b42f4c5c23c6f42fadf2e8fc28d6ff10b39c14d039785805c0fe553967e`
- `git apply --reverse --check --unsafe-paths /private/tmp/r16-open-design-host-composition.patch` — PASS

| File | Composition preimage SHA-256 | Postimage SHA-256 |
| --- | --- | --- |
| `apps/electron/package.json` | `8ba22a34e43daa60fb8926c39b069a45b853d151928d928b60dc771372f2a44d` | `46461f628fe524f0f5ba34c75128d653f4449e2a218fb5b7c53294a55219978d` |
| `apps/electron/src/main.mjs` | `64023c2ea0d056d450c4ce5b9d95cc4d3e56dccb8a4ea748aa3b8d9892c09b97` | `6eed67fa92b747e4e80705e082368155737a79f4d351df4482c789ee1d21410d` |
| `apps/electron/src/preload.cjs` | `fcde175d2eccdf997d7734a9746fd9c77c0d3169bd3651470285b0cee2ea0522` | `241d84f2d9d5d5f27fd6c35f53c590c865384e7292cf746d78ca472532338fd8` |
| `apps/electron/src/security-smoke-receipt.mjs` | `39cc326a75794a2edd61429c0acfe269008806754363af2aa4bba9efd6ed04e2` | `d96b19a40ab2e410de141478021e1eae376e69251073e156096def256185ec35` |
| `apps/electron/test/dayflow-host-hooks.test.mjs` | `b998099bc925f0541e6a1a8a87d9dac19edf69e629e276e32d405a8f97a293c7` | `e8f009318323f5fb4d5be142e8fb3f136ca6da765009b71560d5c29ba8b33d87` |
| `apps/electron/test/open-design-preload-hook.test.mjs` | `fe8349575e51c1d487aa36bc651fedce06bdc88b074a443b201fe3e562dd4a09` | `04d299290934e036403d1ab14432f80705267d1705acf2c282104d7a1eef4a20` |
| `apps/electron/test/security-smoke-receipt.test.mjs` | `0fb25fa405c62a189ed0f2787a8380e88d01c2fe70796612edfba6c91fcfed38` | `98df0c97cbdad2b365310ab8697efcbeb9dbc151f1abed5815d337e175834d76` |

The mechanically accepted dependency bytes remain untouched in this run:
`dayflow-desktop.mjs` `f4d27354e0c1f3ef7fc127457c5b2e915f6a61acb91441e2d8d485ee64e3d2b8`,
`dayflow-desktop-artifact.mjs` `e930fc4791fbfa53bac2503e982cdb0e77f5d72636551d893d8921819e88f6e2`,
`open-design-runtime.mjs` `5b41a406295b29ae44ca182c81eb22d5e2ceab97ce6f97cee8649f2a44ab75d2`,
`open-design-view.mjs` `e3cfd860892ac6d9063f93c546a1fa317dff5c68bd05b33c047688effe7b191d`,
and `rhythm-agent-tools.mjs` `a84b4682a21b194f78c28780cc1d9d7ff6afc815e954b009ad1a080de3fecf6f`.

## Checks

- PASS — `cd apps/electron && node node_modules/typescript/bin/tsc --noEmit --pretty false`
- PASS — `cd apps/web && node node_modules/typescript/bin/tsc --noEmit --pretty false`
- PASS — from `apps/electron`:

  ```sh
  node --experimental-vm-modules --test --test-concurrency=1 \
    test/dayflow-host-hooks.test.mjs \
    test/security-smoke-receipt.test.mjs \
    test/rhythm-agent-tools.test.mjs \
    test/open-design-runtime.test.mjs \
    test/open-design-view.test.mjs \
    test/open-design-preload-hook.test.mjs
  ```

  Result: 58 passed, 0 failed. All Electron, runtime-discovery, command, and
  view inputs were injected VM fixtures; no Electron binary, installed
  OpenDesign/Dayflow app, native command, socket/listener, backend, or server
  was launched.
- PASS — `node --check` for owned main/preload/security/test sources and
  `git diff --check`.

## Remaining gates

This is source qualification only. The normal combined Electron build, signed
package verification, actual native OpenDesign render/attach/detach/tab-return,
menu/notification behavior, sign-in/profile-reset behavior, persistent
coordinator validation, Dayflow launch verification, and human normal-app
acceptance remain root-owned and unverified. No package, sign, install, launch,
native smoke, browser/UI drive, service probe, or private-data operation ran.
