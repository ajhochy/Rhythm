---
date: 2026-08-17
repo: Rhythm
branch: codex/react-electron-live-suite
pr: 1399
issues: []
status: partial
tags: [run, Rhythm]
---

## Files

Merged from four isolated worktrees into `codex/react-electron-live-suite` at `5cdd8b79`:

- `apps/web/src/components/{Composer,Inspector,Profiles,SessionRail,Shell,ToolWorkspace,Transcript}.tsx`
- `apps/web/src/gateway/{commands,cookbook,designs,index,research,run-quality,sessions}.ts` (4 new domains)
- `apps/web/src/store.tsx`, `apps/web/src/types.ts`
- `apps/web/src/pages/automations/index.tsx`, `apps/web/src/pages/dashboard/LiveArtifactsShell.tsx`
- `apps/web/index.html` (CSP hash allowlist for the artifact bridge)
- ~20 Playwright test/config files (new redspecs, mock repairs, port canonicalization)
- `docs/ai/contracts/post-m1-phase-9.json`, `docs/ai/plans/2026-08-15-post-m1-parity-phases.md`

## Checks

- Fixture: phase-3 129/129, phase-4 2/2, phase-5 17/17, phase-6 14/14, phase-7 12/13, phase-8 10/10,
  phase-9 4/4, phase-10 12/12, auth 9/9.
- Live: phase-3 13/13, phase-4 9/9, phase-9 (mobile-access 1/1, session-continuity 1/1), phase-10 2/2.
- `apps/api_server` phase-8 vitest 4/4; `apps/electron` phase-8 artifact-policy 2/2.
- `npm run typecheck` clean.
- `verify-all.mjs` and parity-matrix regeneration NOT re-run this session — flagged as next step.

## Notes

Continuation of the post-M1 parity program (Phases 5-10 UI, capability inventories: 74 missing
capabilities across Phases 3-10). This run picked up after two data-loss incidents from a concurrent,
unrelated Claude Code session sharing the working directory (documented in prior runs/decisions),
moved all further work to dedicated git worktrees, and completed:

- **Cross-cutting Phase 5/7 fixes** (direct, in the shared isolated worktree): canonical
  `permissionMode` values crossing the live PATCH boundary instead of display strings; a live
  slash-command gateway (`gateway/commands.ts`) replacing the hard-coded four-item list, dispatching
  `session.command` frames instead of folding into `session.input`; `disabledReason` correctly
  distinguishing fixture-only `parentId` from canonical live `parentSessionId`; Review Queue wired to
  the real signed `GET /agent-approvals` boundary instead of seeded org-optimizer proposals;
  `SessionGateway.toolSurface()`/`.dispatchMcp()` added, the latter an honest real-but-rejecting method
  since the opencode engine has no primitive to execute one MCP tool outside a model-originated MCP
  App binding.
- **A real crash bug**, not a test gap: `gateway/commands.ts`'s `list()` didn't validate the response
  was an array; a redspec's generic `{ok:true}` catch-all crashed the whole render tree via
  `liveCommands.map()`, manifesting as a false "14/14 regression." Root-caused via full (untruncated)
  Playwright output, not the tail-truncated summary.
- **Phase 8** (agent): live-artifact sharing dialog, HTML import flow, a real postMessage capability
  bridge for the `pco.services.read` MCP-App surface (catching a `srcdoc`-inherits-parent-CSP issue,
  fixed via a SHA-256 script-hash allowlist rather than `unsafe-inline`). Fixture 4/10 → 10/10.
- **Phase 9** (agent): found most of the real pairing/relay backend and the React Mobile Access page
  already shipped under different names from earlier, unrelated PRs; added the one genuine gap (a
  session-continuity live redspec covering reconnect/backoff, real-file `parts`, scoped diff, child
  session identity).
- **Phase 10** (agent): found Automations was the sole route accepting three invented `SurfaceState`
  literals (`catalog-empty`/`invalid-config`/`provider-error`) outside the canonical 7; fixed by
  deriving them for real in live mode and moving fixture-mode access to a distinct `?dependency=`
  param. Everything else in Phase 10's contract has no test authored yet — reported as net-new work,
  not approximated.
- **Phase 7 remainder** (agent): live Research Projects, Cookbook, Playbooks catalog, Gallery, Report
  Card, and approval cards — six of seven remaining criteria. The seventh (`c4d`, approve/reject
  signature) is honestly red: no approval signer exists in this build; documented rather than faked.

## Incident: cross-worktree Playwright port collisions

Discovered mid-session: every `*.config.ts` under `apps/web/tests/` (including `tests/gateway/`)
hardcodes one of 8 shared ports. Four worktrees running concurrently silently reused each other's dev
servers via `reuseExistingServer: true`, producing a phantom "14/14 regression" (actually the commands.ts
crash bug above) and, separately, a genuine cross-worktree collision the Phase 10 agent caught and
undid on its own after independently verifying rather than trusting a relayed "coordinator" message.
Resolved by giving each worktree a large, disjoint port offset during the session, then resetting every
config back to canonical values as part of the final merge, plus fixing a few CORS-origin literals that
had been hardcoded to a stale port. Next time: either don't run more than one worktree's Playwright
suite concurrently, or give each worktree a permanent, disjoint offset up front.

## What's left

- Phase 11 (signing/notarization): deliberately not attempted — needs real Apple credentials and an
  actual release dispatch, gated on AJ's explicit approval. See the plan doc's decisions section.
- `post-m1-p7-c4d`: needs a real approval signer (Electron main + Keychain bridge).
- `verify-all.mjs` full M1 gate, SHA256SUMS/PROVENANCE reconciliation, and parity-matrix regeneration
  against current `origin/main` Flutter — not re-run this session.
- Manual smoke test of PR #1399 by AJ.
