---
date: 2026-09-26
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [task-safe-external-links]
status: ready-for-verification
tags: [run, Rhythm]
---

# Safe external transcript links

## Root cause

`SafeMarkdown` deliberately rendered every safe URL as a disabled span because the renderer had no narrow host capability. Enabling anchors without a main-owned trust boundary would have let untrusted model output navigate the renderer or invoke arbitrary OS URL handlers.

## Files

- `apps/web/src/components/SafeMarkdown.tsx` — local `ExternalLink`; React-owned DOM; no direct navigation.
- `apps/web/src/main.tsx` — typed optional `openExternal` bridge capability.
- `apps/electron/src/preload.cjs` — frozen bridge v7 with only `openExternal(url)` for this feature.
- `apps/electron/src/main.mjs` — owned-document IPC and URL validation/canonicalization before `shell.openExternal`.
- `apps/electron/src/security-smoke-receipt.mjs` — exact bridge key/version receipt.
- Focused Playwright, Electron IPC, and receipt tests; contract JSON; durable screenshot.

## Acceptance-contract RED evidence

- `cd apps/web && npm exec -- playwright test --config tests/electron-e25a-playwright.config.ts` — expected RED: 9 passed, 4 failed because the safe link remained a disabled span and never dispatched.
- `cd apps/electron && node --experimental-vm-modules --test test/electron-shell.test.mjs test/security-smoke-receipt.test.mjs` — expected RED: 23 passed, 3 failed because bridge v6 had no `openExternal` and main had no handler.

## Checks

- `cd apps/web && npm exec -- playwright test --config tests/electron-e25a-playwright.config.ts` — PASS, 13/13. Produced `docs/ai/runs/artifacts/safe-external-links/transcript-safe-external-links.png`.
- `cd apps/electron && node --experimental-vm-modules --test test/electron-shell.test.mjs test/security-smoke-receipt.test.mjs` — PASS, 26/26.
- `cd apps/electron && npm run typecheck` — PASS.
- `cd apps/web && npm run typecheck && npm run build && npm run test:dist-smoke` — PASS; 1,744 modules built; dist index and 2 relative assets verified. Existing Vite chunk-size warning remains.
- `cd apps/electron && npm test` — 430 passed, 3 skipped, 1 failed out of 434. The unrelated existing `agent-server-ownership.test.mjs` relay-restoration assertion expected `wss://team.example/tenant/relay/uplink` but received `wss://api.vcrcapps.com/relay/uplink`; isolated replay failed identically. No out-of-scope repair attempted.
- `git diff --check` — PASS.
- GitNexus `detect_changes(scope=all)` — LOW, 24 changed symbols, 0 affected symbols/processes. The scan includes preserved concurrent/pre-existing work as well as this slice.

## Security analysis

- Doubt review: the wrong implementation would let untrusted model output navigate the renderer or invoke arbitrary OS URL handlers (`file:`, `javascript:`, `data:`, or custom schemes). The implemented minimum guard keeps renderer navigation prevented, exposes one preload method, and re-validates in main.
- Renderer only enables syntactically valid, credential-free HTTP(S) destinations without whitespace/control/format characters; all other markdown links remain text. Raw HTML remains text and images never load.
- Main accepts exactly one non-empty string of at most 4096 characters from the owned main frame/document, rejects whitespace/control/format characters, credentials, malformed URLs, extra arguments, foreign senders/frames/documents, and every non-HTTP(S) scheme, then dispatches only the canonical URL.
- OS rejection is reduced to `External link could not be opened.` in a link-local status; internal errors never reach transcript DOM.
- The frozen closed bridge is version 7. No generic shell object, arbitrary IPC method, `window.open`, popup, or confirmation dialog was added.

## Limitations

- No package/sign/notarize, manual app launch, or release work was performed. The requested Electron test harness internally starts its existing hidden smoke child.
- The existing sandbox at `/private/tmp/rhythm-external-links-sandbox` and ports 7397–7399 were not touched; this UI/host-boundary slice required no backend live test.
- Pre-existing attachment/model-search changes were preserved; no unrelated production file was edited.

## UI review follow-up

- RED: `cd apps/web && npm exec -- playwright test --config tests/electron-e25a-playwright.config.ts --grep 'task-safe-external-links-c9|task-safe-external-links-c10'` — 0 passed, 2 failed: enabled links had no `aria-describedby`, and failure text lacked visible separating parentheses.
- Added a per-link React `useId` description: `Opens <hostname> in the default browser.` The existing `sr-only` utility keeps visible link text clean while `aria-describedby` exposes stable non-hover semantics; `title` remains unchanged.
- Kept each link-local `role=status` node mounted and changed its failure rendering to the exact visible text ` (External link could not be opened.)`.
- `cd apps/web && npm exec -- playwright test --config tests/electron-e25a-playwright.config.ts` — PASS, 15/15.
- `cd apps/web && npm run typecheck && npm run build && npm run test:dist-smoke` — PASS; 1,744 modules built; dist index and 2 relative assets verified. Existing Vite chunk-size warning remains.
- No Electron security policy, preload/main process code, CSS, or other production file changed in this follow-up.
