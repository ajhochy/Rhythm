---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-4]
status: complete
tags: [run, Rhythm]
---

# Post-M1 Phase 4 capability inventory

## Files

- Created `docs/ai/coverage/react-electron/phase-4-session-lifecycle-inventory.md`.
- Created `docs/ai/contracts/post-m1-phase-4.json`.
- Created this run note.
- No code, tests, existing contracts, project state, branch, index, or remote state changed.

## Checks

- Read Phase 4 in `docs/ai/plans/2026-08-15-post-m1-parity-phases.md` before repo implementation files.
- Read Flutter only from `origin/main` (`9fa2761ed78159f83f56982c03fcd85dc035039a`) via read-only `git ls-tree`, `git show`, and `git grep`.
- Traced Flutter view/controller/repository/data/model paths for list/detail/create/delete, composer attachments, structured transcripts, cancel/resume/reconnect/retry, pagination, child transcripts, and identities.
- Traced React `AgentsWorkspace`, `Composer`, `SessionRail`, `Transcript`, store/session state, gateway, and types.
- Traced API routes/controller, WebSocket gateway, stream bridge, session repository, message repository, and canonical type declarations.
- Reused the Phase 2 identity inventory rather than re-deriving model/session identities from display strings.
- Parsed `docs/ai/contracts/post-m1-phase-4.json` as JSON and checked its top-level shape against Phase 1 after creation.
- Did not run a test suite, parity generator, `verify-all.mjs`, Playwright, GUI, server, sandbox, or port command.

## Notes

- Found 12 user-visible capabilities present in Flutter and absent from live React/Electron.
- Highest-risk gaps are attachment non-delivery, first-delta-only streaming, structured-part flattening, local-only cancel/resume/lifecycle actions, and absent reconnect/queue semantics.
- Confirmed canonical list scope is `self_improvement`, not React's display/state literal `background`.
- Confirmed the four identity/model layers from Phase 2: Rhythm `profileId`; local session `id`; engine session `sdkSessionId`; persisted session `providerId`/`modelId`; API-to-engine `{providerID, modelID}`; fork-persisted `{id, providerID, variant?}`.
- Contract contains 20 pending executable sub-criteria across the four planned acceptance families, including one explicit criterion for each missing capability.
