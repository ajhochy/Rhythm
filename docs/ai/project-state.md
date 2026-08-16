# Project state — React/Electron live suite

_Snapshot: 2026-08-15. Overwrite this file; do not append._

## Focus

Post-M1 parity, phase by phase. Milestone 1 (import, wire, harden, cover) is COMPLETE.
Authoritative plan: `docs/ai/plans/2026-08-15-post-m1-parity-phases.md`.

## Branch / PR

- Worktree: `/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite`
- Branch: `codex/react-electron-live-suite` (all work UNCOMMITTED; branch base `9d8c4443`)
- AJ 2026-08-15: **stay off `main`.** No rebase, no merge. The parity matrix reads the Flutter
  reference from `origin/main` (`9fa2761e`) instead — the branch itself does not move.
- No PR. Nothing committed, pushed, or merged.

## Slice status

Slices 0–8 all PASS. Post-M1: **Phase 1 at 11/19 criteria** (host trust closed), phases 2–11 not
started. Weighted program re-based to 858 units — P10 is 28.7% (was 48.4%), P5 is 25.3% (was 13.6%).

## Verified evidence (orchestrator-run, 2026-08-15, single `verify-all.mjs` invocation)

```text
web:typecheck pass · web:build pass · web:fixture 14 · web:suite 254 · dist-smoke pass
web:gateway-sessions 4 · web:live-lifecycle 1 (182.7s) · electron:shell 5 · electron:packaged 6
parity behaviors 17 · reviewRequired 708 · mappings 10930 · flutter_sha 9fa2761e
residue: webTestResults false, persistentUserData false, smokeUserData 0, worktrees 0, branches 0
protectedPorts contacted: []
```

Provenance root: `0b2d3b22d0b9f75ea5b4c0a6962a24751637adf789f3d51b8944c07e418541a4`
(`apps/web/SHA256SUMS`, 144 entries). Untouched this session — every new file was new, none covered.

## Phase 1 contract — `docs/ai/contracts/post-m1-phase-1.json`

```text
pass 11 · red 3 (c2c, c2d, c3b) · pending 3 (c1b live, c2e/c3e packaged) · not_tested 2
```

Closed this session: deep-link fail-closed policy, single-instance lock routing second-instance and
open-url through one validated funnel, and packaged proof that a second launch yields. c3c/c3d and
c2a turned out never to have been red — a wrong state literal and a load timeout.

`not_tested` means the surface does not exist yet, with a re-open condition: `c4d` owned-child
registry (the host spawns nothing) and `c4b-dialog` (the host never calls `dialog.*`). Building
either now would be dead code satisfying a source-text regex.

Still red: focus does not return to `account-button`/`nav-more` after menu activation (c2c/c2d);
an edited session setting does not survive renderer reload (c3b).

RED specs carry a `.redspec.ts` suffix so `playwright.config.ts` (`testDir: './tests'`) cannot
collect them into the M1 regression gate. Rename to `.spec.ts` as each goes green.


## Operational facts that changed this session

- `codex exec --sandbox danger-full-access` is refused by the Claude Code permission classifier. Use
  `--sandbox workspace-write -c sandbox_workspace_write.network_access=true --skip-git-repo-check`
  with `< /dev/null`.
- **Codex cannot launch Chromium** under `workspace-write` (Mach rendezvous denial → SIGABRT).
  Codex authors Playwright specs; the orchestrator executes them.
- `slice-7-c6` compared the repo-wide worktree registry including every unrelated worktree's HEAD, so
  concurrent commits in the other seven worktrees reddened the gate. Narrowed to worktree PATHS with
  AJ's approval; property-proved (HEAD-move ignored, leak still detected).

## Risks / open items

- **Phase 8's stated premise no longer holds.** Its "near-zero matrix evidence" was the `categoryFor`
  bug, now fixed: `live-artifacts` carries 78 mappings, not 1. Re-derive the phase scope from the
  corrected corpus before writing its contract. Phase 2's BUILD framing is unaffected —
  `profiles-providers-models` and `ownership-isolation` are still genuinely 0.
- **The packaged single-instance check is not a `verify-all.mjs` component yet.** Wire
  `apps/electron/test/post-m1-phase-1-packaged-host.test.mjs` in together with c2e/c3e so all Phase 1
  packaged checks join the runner in one change.
- **OS-level URL-handler registration is deliberately absent** (`setAsDefaultProtocolClient`,
  `CFBundleURLTypes`) because it would change the packaged bundle and risk the Slice 7 byte-manifest
  assertions. Until it lands, only CLI/argv-delivered URLs exercise the deep-link funnel.
- **Hard delete returns 204 while `removeWorktree` returns 400.** Cleanup reports success while
  engine-side worktree removal fails. Unconfirmed root cause; follow-up.
- **Isolated session create is slow because of engine `createSession` on a NEW worktree cwd**
  (1,459–2,093 ms of a 1,528–2,183 ms request; 8–10 ms on an established cwd). The load multiplier that
  produced 22.8 s / 61.1 s / >90 s is still unexplained — a cold sample was blocked by the sandbox's
  stale-PID guard.
- **`POST /agent-sessions` surfaces a raw `SDK_ERROR` when the engine is mid-bounce.** Still queued.

## Next step

The three remaining Phase 1 reds, all real product gaps in `apps/web/src`: focus return after menu
activation at wide and narrow sizes (c2c/c2d, `Shell.tsx`), and session-setting persistence across
renderer reload (c3b). Then the three orchestrator-run pending checks (c1b live readiness, c2e
packaged keyboard, c3e packaged relaunch), and wire the packaged checks into `verify-all.mjs`.

## Recent coding-agent runs

### 2026-08-15 — Post-M1 Phase 3 domain gateways
- Files modified: eight new `apps/web/src/gateway/` family modules, one combined Phase 3 redspec and
  collection config, and `docs/ai/runs/2026-08-15-post-m1-phase-3-domain-gateways.md`.
- Checks run: pre-implementation RED collection captured; web typecheck PASS; web build PASS;
  post-implementation Playwright collection PASS (10 tests in 1 file); Chromium execution not run
  per unit constraint.
- Decisions made: expose canonical API DTO vocabulary without mapping to page fixture shapes; keep
  fixture factories network-free and unsupported; persist AI import through existing canonical
  create routes; leave central gateway composition to page wiring because GitNexus impact could not
  complete while its index had a pending WAL.
- Deviations from spec: none.
- Concerns: orchestrator must execute the collected redspecs and reconcile provenance/checksums; no
  page wiring or live two-actor behavior was exercised in this unit.

### 2026-08-15 — React/Electron Google desktop sign-in
- Files modified: Electron OAuth core/host/build config/preload/main/package tests; web auth gateway,
  startup boundary, focused RED specs/config; `docs/ai/contracts/issue-2010.json`.
- Checks run: web typecheck/build PASS; Electron typecheck/syntax PASS; Node OAuth contracts 5/5
  PASS; Playwright auth collection 9 tests in 2 files PASS (execution prohibited in this unit).
- Decisions made: compile the public `GOOGLE_DESKTOP_CLIENT_ID` into the packaged main-process
  config under the same variable name as Flutter; expose one frozen no-argument IPC method; keep
  `VITE_RHYTHM_LIVE_TOKEN` explicitly TEST-ONLY.
- Deviations from spec: real Google consent, Chromium execution, Electron launch, and packaging were
  not run because this implementation unit explicitly prohibited them.
- Concerns: the orchestrator must run the collected UI contract and package with the existing
  `GOOGLE_DESKTOP_CLIENT_ID`; no real credential value is present in this checkout.
