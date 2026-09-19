---
date: 2026-09-18
repo: Rhythm
branch: mega/fix-hermes-review
pr: null
issues: [1542]
status: partial
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Hermes adversarial-review repair

## Files

- `apps/electron/src/hermes-server.mjs` now requires a 2xx Hermes health JSON
  payload and retains the last non-2xx status for timeout diagnostics.
- `apps/electron/src/hermes-view.mjs` uses a unique non-persistent partition,
  scopes main-process Bearer injection to the Hermes origin, clears the session
  on detach, and forwards validated draft intents through the document port.
- `apps/electron/src/hermes-view-preload.cjs` opens `/chat` and fills the xterm
  helper textarea with one `input` event, without Enter or submit.
- Electron and web acceptance coverage plus the Hermes contract were updated.

## Checks

- `cd apps/electron && npm run typecheck && node --experimental-vm-modules --test test/hermes-server.test.mjs test/hermes-view.test.mjs test/hermes-protocol.test.mjs test/security-smoke-receipt.test.mjs`: pass, 75 tests.
- `cd apps/web && npm run typecheck`: pass.
- `GITNEXUS_HOME=/tmp/rhythm-fix-hermes-gitnexus-home gitnexus detect_changes --scope unstaged --repo Rhythm`: LOW for this repair, 9 tracked files, 39 symbols, and zero affected indexed processes.
- The required compare-to-`main` view is MEDIUM across 298 files and three
  unrelated relay/integration flows already present on the mega branch; it is
  not the scoped risk result for this repair.
- `git diff --check`: pass.

## Notes

The requested probe at `http://127.0.0.1:9122/api/health` was unavailable. The
installed Hermes `web_server.py` handler defines the accepted payload as `ok:
true`, a string `version`, and a boolean `auth_required`. Its loopback middleware
accepts an Authorization bearer for HTTP, while its WebSocket path still accepts
only Hermes's own token query handoff. Cookie auth and single-use WebSocket
tickets belong to gated auth and do not apply to this loopback dashboard.

Playwright, Electron, Vite, and socket-based smoke were not run by instruction.
The rendered spec was updated, but real runtime/rendered qualification remains a
manual follow-up. No commit, push, PR, merge, stash, or checkout was performed.
