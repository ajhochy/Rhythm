# Summary

Fixed the Hermes adversarial-review BLOCKER and both MAJOR findings on
`mega/fix-hermes-review`:

- Every view attach now uses a unique non-persistent `rhythm-hermes-<uuid>`
  partition. The main process injects the bearer only for the approved Hermes
  HTTP origin, and detach unregisters hooks, clears storage/cache/connections,
  removes the view, and closes its WebContents.
- Readiness now requires a 2xx `/api/health` response with `ok: true`, a
  non-empty string `version`, and boolean `auth_required`. A non-2xx response
  keeps the supervisor in `starting` and its status is included on timeout.
- `new-chat` now succeeds through the existing document-bound MessagePort. The
  isolated preload opens `/chat`, fills Hermes's xterm helper textarea, and
  dispatches one `input` event without Enter, a key event, submit, or `?learn=`.

# Files changed

- `apps/electron/src/hermes-server.mjs`
- `apps/electron/src/hermes-view.mjs`
- `apps/electron/src/hermes-view-preload.cjs`
- `apps/electron/test/hermes-server.test.mjs`
- `apps/electron/test/hermes-view.test.mjs`
- `apps/web/tests/pages/hermes.spec.ts`
- `docs/ai/contracts/hermes-electron-contract.md`
- `docs/ai/contracts/issue-1542.json`
- `docs/ai/project-state.md`
- `docs/ai/runs/2026-09-18-hermes-review-repair.md`
- `REPORT.md`

`apps/electron/src/hermes-protocol.mjs` and the Hermes page implementation did
not need production changes: the existing closed DTO validation and successful
draft status path already support the repaired behavior.

# Checks run

- Launch discipline: worktree path, branch `mega/fix-hermes-review`, and a
  workspace write probe all matched/passed.
- `cd apps/electron && npm run typecheck && node --experimental-vm-modules --test test/hermes-server.test.mjs test/hermes-view.test.mjs test/hermes-protocol.test.mjs test/security-smoke-receipt.test.mjs`: pass, 75 tests, 0 failures.
- `cd apps/web && npm run typecheck`: pass.
- Rendered Hermes spec updated to require an accepted draft intent and the
  user-visible review-before-sending receipt; not executed by instruction.
- `git diff --check`: pass.
- GitNexus unstaged change analysis: LOW risk, 9 tracked files, 39 symbols, and
  zero affected indexed processes. Compare-to-`main` is MEDIUM across 298 files
  and three unrelated flows already present on the mega branch.
- Token-boundary audit: no session token is placed in Rhythm status, IPC/preload
  payloads, URLs, logs, view options, or document-port messages.

# Acceptance criteria

- BLOCKER: pass in source and Node acceptance coverage. Partition names never
  use `persist:`, are unique per attach, and teardown clears the ephemeral
  session. REST authentication is injected only by the main process. Hermes's
  own served page bootstrap remains isolated to that ephemeral session.
- Readiness MAJOR: pass. 401, 404, and 503 responses retry until timeout and
  report the status; malformed 2xx payloads never become ready.
- Draft MAJOR / HRM-B3-AC4: pass in Node integration coverage. The draft is
  editable and no submit-capable event is dispatched. The rendered spec is
  written to assert the accepted intent and confirmation text.
- Original issue AC5 and AC6 Node coverage: pass. Original issue AC1, AC2, AC3,
  and AC7 remain runtime/rendered gates because Electron and Playwright were
  prohibited in this run.

# Decisions

- Used `session.webRequest.onBeforeSendHeaders` with an exact loopback-origin
  filter, preserved unrelated request headers, and replaced any page-authored
  Authorization header case-insensitively.
- Did not set a cookie: the installed loopback server accepts bearer headers for
  HTTP, while its HttpOnly cookies and single-use WebSocket tickets belong to
  the separate gated-auth flow.
- Retained Hermes's served `window.__HERMES_SESSION_TOKEN__` bootstrap because
  its loopback WebSocket accepts only `?token=` and the SPA refuses chat without
  that bootstrap. The unique non-persistent partition is the strictest workable
  containment without modifying Hermes itself.
- Used `/chat` plus `.hermes-chat-xterm-host .xterm-helper-textarea`; Hermes's
  `?learn=` path was rejected because it appends carriage return and submits.
- Normalized CR/LF/tab runs to spaces before prefill so untrusted context cannot
  synthesize terminal submission or completion controls.

# Follow-ups

- Run the existing rendered Playwright and real pinned-Electron authentication,
  WebSocket, focus, zoom, RTL, and hostile-frame qualification before merge or
  release readiness is claimed.
- The requested live health probe on port 9122 was unavailable. The accepted
  payload shape was verified from the installed Hermes `web_server.py` handler.
- `REPORT.md` is present at the worktree root; the repository's ignore rules
  intentionally hide it from normal `git status` output.
- No commit, stash, checkout, push, PR, merge, server launch, or socket-binding
  test was performed.
