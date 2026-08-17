---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-2]
status: complete
tags: [run, Rhythm]
---

# Post-M1 Phase 2 inventory

## Files

- Added `docs/ai/coverage/react-electron/phase-2-identity-ownership-inventory.md`.
- Added `docs/ai/contracts/post-m1-phase-2.json`.
- Added this run note.

## Checks

- Read the full Phase 2 plan section before inventory work.
- Verified `origin/main` is `9fa2761ed78159f83f56982c03fcd85dc035039a` and read Flutter only through read-only `git show origin/main:<path>` / `git ls-tree`.
- Followed profile identity/model paths through Flutter, API CRUD/persistence/sync/model resolution, React gateway/store/components, mobile profile/provider surfaces, and fork session/model/allowlist code.
- Compared the new contract shape with `docs/ai/contracts/post-m1-phase-1.json`.
- Parsed `docs/ai/contracts/post-m1-phase-2.json` as JSON and checked the three deliverable paths only after writing (recorded in the final handoff).
- Per task constraints, ran no test suite, Playwright, parity generator, GUI, server, or port-bound command.

## Findings

- Canonical profile persistence is API `modelProvider`/`modelId`, backed by DB `model_provider`/`model_id`, both nullable strings.
- Engine transport uses `{providerID, modelID}`; session persistence/wire uses `providerId`/`modelId`. Profile ID, local session ID, and SDK session ID are separate identities.
- React `Profiles.tsx` currently edits fixture-only `provider`/`model` display fields and does not use live profile CRUD. The live gateway can list profiles but normalizes guessed spellings and has no profile create/patch/delete methods.
- Existing live evidence PATCHes canonical profile fields and exercises a real engine session, but does not stop/restart the API before creating the new engine session required by Phase 2.
- `agent_configs` has no user, workspace, or project ownership column. Outside local mode, authentication gates the router; after authentication, all users receive the same global rows. In local mode, anonymous access is intentionally allowed.
- Mobile's profile catalog requires a paired device and valid project header, but returns the same global `AgentConfigsRepository().list()`; project validation is not profile ownership.
- The fork scopes sessions by project/workspace and capability allowlists, but has no user claim or Rhythm `profileId`, so it cannot enforce profile ownership.
- Nine inventory entries are unevidenced for the claimed parity/isolation behavior. Most importantly, no four-actor ownership test exists, React live profile CRUD is absent, and provider-secret rendering/error redaction is untested.

## Unanswered questions / blockers

1. Is the intended profile owner a user, workspace, project, or combination?
2. What may a same-workspace non-owner list/read/change?
3. Should cross-workspace access deny with `404` or `403`, including collection/export/import/sync side channels?
4. Is anonymous local access a permanent packaged exception?
5. How should current ownerless projects map to workspaces for profile visibility?
6. May packaged React/Electron add/remove provider credentials, or only select already-configured provider/model IDs?
7. What bounded/redacted error schema should provider configuration expose to the renderer?

The contract leaves all criteria pending. `post-m1-p2-c3a` through `c3e` are also listed in `not_tested` because executable expected outcomes cannot be finalized until the ownership and denial policy is decided.
