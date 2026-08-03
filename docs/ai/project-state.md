# Project State

## Current focus

2026-08-03: Config Doctor remediation (PR #1303) — 4 of 5 tracks from the
72h scheduled-task audit implemented and CI-green, awaiting a full Rhythm
quit+reopen and live smoke (nothing in it is verified end-to-end yet).
Also consolidated the open-PR backlog: the 2026-07-30/31 mobile smoke night
left several stacked branches open whose commits had all already landed in
`codex/mobile-fixes-rollup` (#1284); those are now closed.

## Open PRs

- **#1284** — `codex/mobile-fixes-rollup`, "Mobile Agents reliability,
  parity, and profile scoping (#1277–#1286)". Superset rollup — verified via
  `git merge-base --is-ancestor` to already contain every commit from
  #1259/#1266/#1268 (all closed as redundant, 2026-08-03). CI green
  (Server + Mobile CI). Its own PR body notes #1280 (composer growth
  regression) stays open until a signed multiline-composer smoke passes —
  that caveat now lives here, not on a separate PR. Not merged; awaiting
  human review/smoke.
- **#1303** — `workflow/run-2026-08-03-config-doctor`, Config Doctor
  remediation. CI green (Server + Desktop). See
  [decisions/2026-08-03-auto-approve-scoped-bypass.md](decisions/2026-08-03-auto-approve-scoped-bypass.md)
  for the `librarian` auto-approve decision. Draft; not merged.
  Still needed before merge: full Rhythm quit+reopen (opencode.json/profile
  changes don't hot-reload), then confirm Memory Consolidation actually
  captures > 0 and `GET /agent-schedules/:id/runs` returns real history.

## Closed as redundant (2026-08-03)

#1259 (MSP-005 native composer), #1266 (MSP-002 three-dot config), #1268
(R1–R6+P0 combined smoke-vehicle branch) — all fully contained in #1284,
confirmed by commit ancestry, not just title inspection.

## Config Doctor audit — Track A (done outside this repo, no PR)

`~/.config/opencode/opencode.json`: removed dead `foo` entry; `scrapling`
disabled after tracing 3 stacked upstream breaks (mcp 2.0 relocation →
hardcoded Chrome 149 fingerprint gap in browserforge's dataset → missing
camoufox binary) — `theological-research-daily` needs a different fetch
backend if re-enabled. `Org External Discovery` schedule disabled via API —
confirmed `mcp-registry` was never a real server (checked the official MCP
registry, GitHub's client SDK, and two dead hobby packages; none fit).
Both opencode.json edits need the pending full-app relaunch to take effect.

## Config Doctor audit — Track E (done, no diff)

`npm run doctor` was broken by `node_modules` drift in `apps/api_server`
(not a missing dependency declaration) — fixed with a root `npm install`,
zero manifest changes. Also surfaced a Python 3.9.6 (needs ≥3.10) gap not in
the original audit.

## Risks

- Nothing in PR #1303 is verified against the live app yet — nothing has
  actually captured a memory, written a run-history row, or hit the
  glob-watchdog/partial-result-recovery paths for real. CI green is not
  behavioral proof (this is the exact lesson #1259/#1280 already taught this
  repo: don't merge on CI alone when the fix depends on live agent runtime
  behavior).
- The running api_server on :4001 is on a different worktree/branch
  (`codex/mobile-fixes-rollup`) than `workflow/run-2026-08-03-config-doctor`
  — it will not reflect PR #1303's code until the app is rebuilt from that
  branch (or merged) and relaunched.

## Next step

1. Full Rhythm quit + reopen.
2. `curl -X PATCH http://localhost:4001/agent-configs/librarian -d '{"autoApproveActions": true}'`
   (or confirm the PR's own migration/default already set it once merged).
3. Trigger Memory Consolidation, confirm `Captured: N` with N > 0.
4. Check `GET /agent-schedules/:id/runs` returns real history for a couple
   of tasks.
5. Human review/merge of #1284 and #1303 (both currently draft, neither
   merged).
