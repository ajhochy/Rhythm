---
date: 2026-09-11
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [E27]
status: PASS
tags: [run, Rhythm]
---

# E27 local terminal parity

## Files

- `apps/web/src/components/Inspector.tsx`: live terminal uses official xterm, existing PTY gateway, native ResizeObserver. Inspector retains per-session terminal/socket/scrollback across tab, collapse and selection changes; explicit Close releases them. Inspector unmount also cleans up (pending create included). Errors surface Retry; exited/closed offers New. Fixture terminal explicitly labeled.
- `apps/web/src/components/terminal.css`: PTY-scoped layout, size measurement and focus styling; no shared stylesheet edits.
- `apps/web/src/gateway/pty.ts` and three composition lines in `gateway/index.ts`: existing POST session PTY, PATCH size, DELETE, raw WebSocket; localFetcher keeps cloud bearer off local requests.
- E27 rendered/live tests, dedicated Playwright config on4184, one `contracts/electron-e27-pty.json`, this canonical run note.
- Manager-owned package/lock already contain official @xterm/xterm6.0.0. No dependency install or network fetch performed here.
- Removed stale `2026-09-11-electron-e27-pty-replacement.md` after merging its historical finding below. No peer-owned files edited.

## Checks

### Phase 0 — complete

Invoked acceptance-contract first; read assigned AGENTS, project-state, current-plan, testing-guide and actual Inspector/gateway/PTY route/proxy source. One Inspector render site; test drives the actual Agents composing view. Orchestrator skill unavailable; executed the manager's bounded dispatch directly.

Working directory: `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement/apps/web` for commands below. Initial `git status --short && git branch --show-current` confirmed assigned branch and concurrent changes.

```sh
./node_modules/.bin/playwright test --config tests/electron-e27-playwright.config.ts tests/electron-e27-pty.spec.ts
```

Before implementation: **5 assertion failures**. c1/2/3/5 expected real xterm output but element absent; c4 expected HTTP503 recovery, received `Not yet liveFixture…`. Only HTTP/WebSocket boundaries intercepted; no xterm/Inspector/gateway mocks.

Harness correction before that red run: first attempt omitted explicit Vite synthetic token and stalled at sign-in. Tool timeout left E27 Vite4184 PID28479; `lsof -nP -iTCP:4184 -sTCP:LISTEN` and `ps -p 28479 -o pid=,command=` verified exact worktree Vite process; `kill 28479` removed only our renderer. No API/engine processes touched. The subsequent corrected run above produced the five real assertion failures.

### Phase 1 — complete

GitNexus upstream impact for TerminalPanel, Inspector, createLiveGateway: **LOW**, each one direct/three total dependents, zero indexed processes. Existing PTY API is only consumed, not edited (manager's PTY API LOW result retained). No HIGH/CRITICAL result.

### Phase 2 — complete

Same focused rendered command: **5 passed (5.6s)** on first implementation validation; no implementation repair required. Covers selected route, ANSI consumption, typed pwd/Enter/Ctrl-C, resize values and viewport change, A background output across tab/collapse, distinct B cwd and output isolation, failed create/Retry, normal exit/New, Close DELETE/socket disposal and clean replacement.

```sh
npm run typecheck
RHYTHM_LIVE_E2E=1 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-electron-phase1-wave3 E27_AUTH_TOKEN=e02-synthetic-session-not-a-secret ./node_modules/.bin/playwright test --config tests/electron-e27-playwright.config.ts tests/electron-e27-pty-live.spec.ts
```

- Web typecheck: **exit0**, `tsc -b`.
- Live check: **1 passed (960ms)**. Explicit public synthetic token/root; readiness checked, new test-owned no-prompt session and PTY created. Observed:

```text
E27 authorized PTY: nonce executed and cwd matched selected local session
E27 real PTY: 29x91 stty size; Ctrl-C interrupted sleep30; same shell executed reuse nonce within5s
E27 cleanup: PTY DELETE 204
E27 cleanup: session DELETE 204
```

Real check drives HTTP + WS, not renderer: the rendered check is intercepted. No fabricated combined live-renderer evidence. Nonce construction prevents command echo from satisfying execution assertions.

- Root `git diff --check && git diff --stat && git status --short`: exit0. Own source changes confined to assigned Inspector, gateway composition, new PTY gateway/CSS; peer E20/E26 changes preserved.
- `gitnexus_detect_changes(scope: all, repo: Rhythm, worktree: assigned worktree)`: **LOW**, 58 symbols/eight tracked files, zero affected processes. Includes concurrent E20/E26 and stale-index line attribution; unchanged Files/Changes symbols were reported because inserted terminal code shifted lines. New untracked source is not indexed evidence.
- Final rerun of the contract's two commands chained with `&& git diff --check`: **5 rendered passed (3.6s), 1 live passed (862ms), whitespace exit0**; same real nonce/size/interrupt and DELETE204 output.

## Notes / handoff

**READY_FOR_VERIFICATION** for the assigned UI slice. Manual target E27-c6: open fixture-mode Agents → Inspector Terminal and verify visible Fixture badge. Also retain packaged/long-running visual smoke (not run): terminal font/fit, scrolling and shell interaction. These are not claimed automated passes.

Deliberate limit: one retained xterm with 2000-line scrollback per opened session, until explicit Close or Inspector unmount; no new reconnection daemon, dependency addon or backend contract. Retry disposes/deletes old PTY before replacement rather than replaying output into an existing buffer. First output, not WS upgrade alone, enables stdin because the current proxy attaches engine asynchronously.

No commit/push/PR/issues/peer dispatch, full suite/build/package, external network, sandbox restart/down or provider prompt. Shared synthetic API4098/engine4097 remain manager-owned and untouched except the cleaned test-owned session/PTY. Dashboard publication omitted under this dispatch's bounded/no-external-network scope.

### Historical failed dispatches — preserved, not current acceptance

Prior dependency preflight found no installed/cached xterm; no implementation/tests ran. Manager has since provisioned official package6.0.0; that blocker is resolved.

The older e27-pty-replacement dispatch ran an owned synthetic nonce/cwd check plus invalid-bearer counterexample: invalid bearer upgraded/executed nonce (expected false, received true). Test-owned PTY/session DELETE both returned204; prior typecheck passed. No implementation was made. Prior command used the same explicit wave3/root/token and E27 config, with its then-security test. Its run note has been merged here, and test replaced by the current requested first-party IO check. **That backend upgrade finding is not repaired or security-qualified by this UI work.** User/manager superseded that security scope with the current acceptance; no backend file was edited.

### Integrated authentication repair pending live rerun

The manager restored invalid/malformed bearer assertions and added optional-bearer validation to the shared local WebSocket upgrade path. An absent header remains compatible with the local desktop; a supplied token must resolve through the same local/Cloud identity service as HTTP. The corrected focused live rerun passed: invalid bearer and whitespace Authorization were rejected, valid bearer retained full terminal behavior, and an absent header opened the local desktop PTY. A focused rendered E27-c1 rerun also passed and captured `docs/ai/runs/artifacts/e27/live-terminal.png`.

Integrated rebuilt-sandbox result: E27 live test 1/1 PASS. Invalid supplied bearer was rejected before bridging; the synthetic valid bearer then executed the nonce, matched cwd, resized to 29x91, interrupted sleep, reused the shell, and cleaned PTY/session with 204 responses.
